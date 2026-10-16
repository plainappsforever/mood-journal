package expo.modules.moodwidget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.util.Log
import android.view.View
import android.widget.RemoteViews

private const val TAG = "MoodWidget"

/**
 * P9: the "Mood" home-screen widget (plain RemoteViews, Breathe/eye-app pattern: no JS runs for it). Five faces, each
 * a PendingIntent to `<scheme>://new?mood=<level>` (SPEC flow 10); a status line with today's colour and the streak, or
 * only "Mood" while the app lock is on (SPEC Privacy). The app pushes a snapshot with a small timeline; a non-waking
 * alarm redraws at the next journal-day start so "today" is never yesterday's.
 */
class MoodWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    render(context, appWidgetManager, appWidgetIds)
  }

  override fun onDisabled(context: Context) {
    alarmManager(context)?.cancel(redrawIntent(context))
  }

  companion object {
    private val FACE_IDS = intArrayOf(R.id.mood_widget_face_0, R.id.mood_widget_face_1, R.id.mood_widget_face_2, R.id.mood_widget_face_3, R.id.mood_widget_face_4)
    private val FACE_BG = intArrayOf(R.id.mood_widget_face_0_bg, R.id.mood_widget_face_1_bg, R.id.mood_widget_face_2_bg, R.id.mood_widget_face_3_bg, R.id.mood_widget_face_4_bg)
    private val FACE_EMOJI = intArrayOf(R.id.mood_widget_face_0_emoji, R.id.mood_widget_face_1_emoji, R.id.mood_widget_face_2_emoji, R.id.mood_widget_face_3_emoji, R.id.mood_widget_face_4_emoji)

    fun componentName(context: Context) = ComponentName(context, MoodWidgetProvider::class.java)

    fun widgetIds(context: Context): IntArray =
      runCatching { AppWidgetManager.getInstance(context).getAppWidgetIds(componentName(context)) }.getOrDefault(IntArray(0))

    fun refresh(context: Context) {
      val ids = widgetIds(context)
      if (ids.isNotEmpty()) render(context, AppWidgetManager.getInstance(context), ids)
    }

    private fun color(hex: String?, fallback: Int) = runCatching { Color.parseColor(hex) }.getOrDefault(fallback)

    private fun linkIntent(context: Context, url: String, requestCode: Int): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      if (ids.isEmpty()) return
      val now = System.currentTimeMillis()
      val snapshot = Snapshot.read(context)
      val views = RemoteViews(context.packageName, R.layout.mood_widget)
      if (snapshot == null) {
        // Placed before the app ever ran: a tap opens the app, which pushes the real snapshot.
        context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
          views.setOnClickPendingIntent(R.id.mood_widget_root, PendingIntent.getActivity(context, 80, it, PendingIntent.FLAG_IMMUTABLE))
        }
        manager.updateAppWidget(ids, views)
        return
      }
      val state = snapshot.pick(now)
      for (i in 0 until 5) {
        val face = snapshot.faces.getOrNull(i)
        if (face == null) {
          views.setViewVisibility(FACE_IDS[i], View.GONE)
          continue
        }
        views.setViewVisibility(FACE_IDS[i], View.VISIBLE)
        views.setTextViewText(FACE_EMOJI[i], face.emoji)
        views.setInt(FACE_BG[i], "setColorFilter", color(face.color, Color.GRAY))
        views.setContentDescription(FACE_IDS[i], face.name)
        views.setOnClickPendingIntent(FACE_IDS[i], linkIntent(context, snapshot.faceUrl(face.level), 90 + face.level))
      }
      views.setTextViewText(R.id.mood_widget_status, state?.status ?: "Mood")
      if (!state?.description.isNullOrEmpty()) views.setContentDescription(R.id.mood_widget_status, state!!.description)
      val today = state?.todayColor
      if (today == null) views.setViewVisibility(R.id.mood_widget_today, View.GONE)
      else {
        views.setViewVisibility(R.id.mood_widget_today, View.VISIBLE)
        views.setInt(R.id.mood_widget_today, "setColorFilter", color(today, Color.GRAY))
      }
      views.setOnClickPendingIntent(R.id.mood_widget_root, linkIntent(context, "${snapshot.scheme}://new", 89))
      manager.updateAppWidget(ids, views)
      scheduleRedraw(context, snapshot.nextChange(now))
      Log.d(TAG, "widget drawn: ${state?.status} (${ids.size})")
    }

    private fun alarmManager(context: Context) = context.getSystemService(AlarmManager::class.java)

    private fun redrawIntent(context: Context): PendingIntent {
      val intent = Intent(context, MoodWidgetProvider::class.java)
        .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, widgetIds(context))
      return PendingIntent.getBroadcast(context, 81, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** RTC (not RTC_WAKEUP), inexact: redraws when the phone is next awake after the day boundary; no permission. */
    private fun scheduleRedraw(context: Context, at: Long?) {
      val am = alarmManager(context) ?: return
      if (at == null) {
        am.cancel(redrawIntent(context))
        return
      }
      runCatching { am.set(AlarmManager.RTC, at + 5_000, redrawIntent(context)) }.onFailure { Log.w(TAG, "redraw alarm failed: ${it.message}") }
    }
  }
}
