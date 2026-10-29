"""Bundle the UI; the pinned Firebase SDK is a separate, offline-cached module."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Keep personal backup files outside the public app directory.
shell = (ROOT / 'src/shell.html').read_text()
for token, filename in [('CSS', 'style.css'), ('I18N', 'i18n.js'), ('CORE', 'core.js'), ('INTELLIGENCE', 'intelligence.js'), ('ADVISOR', 'advisor.js'), ('VIEWS_MODEL', 'views-model.js'), ('INTERACTION', 'interaction.js'), ('FIREBASE_CONFIG', 'firebase-config.js'), ('SYNC_CORE', 'sync-core.js'), ('SYNC', 'sync.js'), ('NOTIFICATION_MESSAGES', 'notification-messages.js'), ('NOTIFICATIONS', 'notifications.js'), ('NOTIFICATION_UI', 'notification-ui.js'), ('APP', 'app.js'), ('ORBIT', 'orbit.js'), ('ASSISTANT_PARTICLES', 'assistant-particles.js'), ('VOICE_METER', 'voice-meter.js')]:
    shell = shell.replace(f'/*__{token}__*/', (ROOT / 'src' / filename).read_text())
if '/*__' in shell:
    raise RuntimeError('Unresolved build token')
(ROOT / 'app/index.html').write_text(shell)
