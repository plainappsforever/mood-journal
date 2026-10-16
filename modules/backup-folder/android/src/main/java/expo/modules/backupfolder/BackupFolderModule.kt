package expo.modules.backupfolder

import android.content.Intent
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

// Mood's local native module (V1_PLAN modules/backup-folder). P5–P7 part: PBKDF2 for encrypted backups (ported from
// warranty-wallet's receipt-ocr module, D21) and FLAG_SECURE while the app lock is on (SPEC Privacy). SAF folder: P8.
class BackupFolderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BackupFolder")

    // FLAG_SECURE: the recent-apps thumbnail and screenshots show nothing while the lock is on.
    AsyncFunction("setSecureWindow") { on: Boolean ->
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      activity.runOnUiThread {
        if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
      true
    }

    // Restarts the app process once (P10): React Native reads the layout direction (I18nManager.forceRTL) only when the
    // process starts, so after switching it for Arabic the app comes back mirrored. Called at most once per change (JS guard).
    Function("restartApp") {
      val activity = appContext.currentActivity ?: return@Function false
      val intent = activity.packageManager.getLaunchIntentForPackage(activity.packageName) ?: return@Function false
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      activity.startActivity(intent)
      Runtime.getRuntime().exit(0)
      true
    }

    // PBKDF2-HMAC-SHA256 for the backup password: native, so 600 000 rounds take about a second.
    AsyncFunction("pbkdf2Sha256") { password: String, saltHex: String, iterations: Int, keyBytes: Int ->
      val salt = ByteArray(saltHex.length / 2) { saltHex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
      val spec = PBEKeySpec(password.toCharArray(), salt, iterations, keyBytes * 8)
      val derived = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
      derived.joinToString("") { "%02x".format(it) }
    }
  }
}
