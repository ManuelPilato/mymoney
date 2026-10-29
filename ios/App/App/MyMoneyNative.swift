import Foundation
import UIKit
import AVFoundation
import Speech
import Capacitor
import GoogleSignIn

final class MyMoneyViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MyMoneyNativePlugin())
        webView?.isOpaque = false
        webView?.backgroundColor = UIColor(red: 3/255, green: 7/255, blue: 8/255, alpha: 1)
        webView?.scrollView.bounces = false
        view.backgroundColor = webView?.backgroundColor
    }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
}

@objc(MyMoneyNativePlugin)
public final class MyMoneyNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MyMoneyNativePlugin"
    public let jsName = "MyMoneyNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "feedback", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startSpeech", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeech", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelSpeech", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openWebApp", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signInGoogle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOutGoogle", returnType: CAPPluginReturnPromise)
    ]
    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognizer: SFSpeechRecognizer?
    private var task: SFSpeechRecognitionTask?
    private var session: String?
    private var lastTranscript = ""
    private var meterFrame = 0
    private var speechTimeout: DispatchWorkItem?
    private var endTimeout: DispatchWorkItem?
    private var backgroundObserver: NSObjectProtocol?
    private var tapInstalled = false
    private let soft = UIImpactFeedbackGenerator(style: .soft)
    private let selection = UISelectionFeedbackGenerator()
    private let success = UINotificationFeedbackGenerator()

    public override func load() {
        backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.finish()
        }
    }
    deinit { if let observer = backgroundObserver { NotificationCenter.default.removeObserver(observer) } }

    @objc func feedback(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            switch call.getString("kind") ?? "selection" {
            case "success": self.success.prepare(); self.success.notificationOccurred(.success)
            case "listening": self.soft.prepare(); self.soft.impactOccurred(intensity: 0.55)
            default: self.selection.prepare(); self.selection.selectionChanged()
            }
            call.resolve()
        }
    }

    @objc func openWebApp(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: "https://manuelpilato.github.io/mymoney/") else { call.reject("Invalid URL"); return }
            UIApplication.shared.open(url) { opened in call.resolve(["opened": opened]) }
        }
    }

    @objc func signInGoogle(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
                  let config = NSDictionary(contentsOfFile: path), let clientID = config["CLIENT_ID"] as? String,
                  !clientID.isEmpty, let controller = self.bridge?.viewController else {
                call.reject("Google iOS configuration unavailable", "auth/configuration-not-found"); return
            }
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
            GIDSignIn.sharedInstance.signIn(withPresenting: controller) { result, error in
                guard let user = result?.user, let idToken = user.idToken?.tokenString else {
                    let code = (error as NSError?)?.code == GIDSignInErrorCode.canceled.rawValue ? "auth/popup-closed-by-user" : "auth/network-request-failed"
                    call.reject("Google sign-in did not complete", code); return
                }
                // Tokens are returned directly to Firebase JS Auth, never logged or written to our archive.
                call.resolve(["idToken": idToken, "accessToken": user.accessToken.tokenString])
            }
        }
    }
    @objc func signOutGoogle(_ call: CAPPluginCall) {
        DispatchQueue.main.async { GIDSignIn.sharedInstance.signOut(); call.resolve() }
    }

    @objc func startSpeech(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finish()
            let id = call.getString("session") ?? UUID().uuidString
            self.session = id
            let locale = call.getString("locale") ?? "it-IT"
            SFSpeechRecognizer.requestAuthorization { status in
                DispatchQueue.main.async {
                    guard self.session == id else { call.reject("Cancelled", "aborted"); return }
                    guard status == .authorized else { self.fail("not-allowed"); call.reject("Speech permission denied", "not-allowed"); return }
                    AVAudioSession.sharedInstance().requestRecordPermission { allowed in
                        DispatchQueue.main.async {
                            guard self.session == id else { call.reject("Cancelled", "aborted"); return }
                            guard allowed else { self.fail("not-allowed"); call.reject("Microphone permission denied", "not-allowed"); return }
                            do { try self.listen(locale: locale, id: id); call.resolve() }
                            catch { self.fail("audio-capture"); call.reject("Audio unavailable", "audio-capture") }
                        }
                    }
                }
            }
        }
    }

    private func emit(_ type: String, _ values: [String: Any] = [:]) {
        guard let id = session else { return }
        var payload = values; payload["session"] = id; payload["type"] = type
        notifyListeners("speech", data: payload)
    }
    private func listen(locale: String, id: String) throws {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.isAvailable else { throw NSError(domain: "MyMoneySpeech", code: 1) }
        self.recognizer = recognizer
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try audio.setActive(true, options: .notifyOthersOnDeactivation)
        let engine = AVAudioEngine(), request = SFSpeechAudioBufferRecognitionRequest()
        self.engine = engine; self.request = request; self.lastTranscript = ""; meterFrame = 0
        request.shouldReportPartialResults = true
        // Prefer on-device recognition where available; no audio is stored by MyMoney.
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        let input = engine.inputNode, format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain: "MyMoneySpeech", code: 2) }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            request.append(buffer)
            guard let self = self, let channel = buffer.floatChannelData?[0] else { return }
            let count = Int(buffer.frameLength)
            var sum: Float = 0
            for index in 0..<count { sum += channel[index] * channel[index] }
            let rms = count > 0 ? sqrt(sum / Float(count)) : 0
            let level = min(1, max(0, Double(rms) * 7))
            self.meterFrame += 1
            if self.meterFrame % 2 == 0 {
                DispatchQueue.main.async { [weak self] in
                    guard let self = self, self.session == id else { return }
                    self.emit("level", ["level": level, "bass": level * 0.7])
                }
            }
        }
        tapInstalled = true
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self, self.session == id else { return }
                if let result = result {
                    self.lastTranscript = result.bestTranscription.formattedString
                    self.emit("result", ["text": self.lastTranscript, "final": result.isFinal])
                    if result.isFinal { self.finish(); return }
                }
                if error != nil {
                    if self.lastTranscript.isEmpty { self.fail("no-speech") }
                    else { self.emit("result", ["text": self.lastTranscript, "final": true]); self.finish() }
                }
            }
        }
        engine.prepare(); try engine.start(); emit("start")
        let timeout = DispatchWorkItem { [weak self] in self?.stopCapture() }
        speechTimeout = timeout; DispatchQueue.main.asyncAfter(deadline: .now() + 45, execute: timeout)
    }
    private func stopCapture() {
        guard session != nil else { return }
        speechTimeout?.cancel(); speechTimeout = nil
        engine?.stop(); request?.endAudio()
        let id = session
        let timeout = DispatchWorkItem { [weak self] in
            guard let self = self, self.session == id else { return }
            if !self.lastTranscript.isEmpty { self.emit("result", ["text": self.lastTranscript, "final": true]) }
            self.finish()
        }
        endTimeout?.cancel(); endTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: timeout)
    }
    private func fail(_ code: String) { emit("error", ["code": code]); finish() }
    private func finish() {
        let wasActive = session != nil
        if wasActive { emit("end") }
        session = nil; speechTimeout?.cancel(); endTimeout?.cancel(); speechTimeout = nil; endTimeout = nil
        engine?.stop(); if tapInstalled { engine?.inputNode.removeTap(onBus: 0) }; tapInstalled = false; engine = nil
        request?.endAudio(); request = nil; task?.cancel(); task = nil; recognizer = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    @objc func stopSpeech(_ call: CAPPluginCall) {
        DispatchQueue.main.async { if call.getString("session") == self.session { self.stopCapture() }; call.resolve() }
    }
    @objc func cancelSpeech(_ call: CAPPluginCall) {
        DispatchQueue.main.async { if call.getString("session") == self.session { self.finish() }; call.resolve() }
    }
}
