package expo.modules.moodwidget

import android.content.Context
import org.json.JSONObject

/**
 * The snapshot the app pushed (src/lib/widgets.ts → AndroidWidgetData): the scheme, five faces and a timeline of
 * states (now, the next journal-day start, the one after). Pure parts (`pick`, `nextChange`) are unit-testable.
 */
data class Face(val level: Int, val emoji: String, val color: String, val name: String)

data class WidgetState(val fromMs: Long, val status: String, val todayColor: String?, val description: String)

data class Snapshot(val scheme: String, val locked: Boolean, val faces: List<Face>, val states: List<WidgetState>) {
  /** The state for `now`: the last one that has started (the first if none has). */
  fun pick(now: Long): WidgetState? = states.lastOrNull { it.fromMs <= now } ?: states.firstOrNull()

  /** When the picture changes next (null = never without the app). */
  fun nextChange(now: Long): Long? = states.map { it.fromMs }.filter { it > now }.minOrNull()

  fun faceUrl(level: Int) = "$scheme://new?mood=$level"

  companion object {
    private const val PREFS = "mood_widget"
    private const val KEY = "snapshot"

    fun parse(json: String): Snapshot {
      val o = JSONObject(json)
      val faces = o.getJSONArray("faces").let { a -> (0 until a.length()).map { i -> a.getJSONObject(i).let { f -> Face(f.getInt("level"), f.getString("emoji"), f.getString("color"), f.getString("name")) } } }
      val states = o.getJSONArray("states").let { a ->
        (0 until a.length()).map { i ->
          a.getJSONObject(i).let { s -> WidgetState(s.getLong("fromMs"), s.getString("status"), if (s.isNull("todayColor")) null else s.getString("todayColor"), s.optString("description", "")) }
        }
      }
      return Snapshot(o.getString("scheme"), o.getBoolean("locked"), faces, states)
    }

    fun save(context: Context, json: String) {
      parse(json) // refuse anything the widget could not draw
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
    }

    fun read(context: Context): Snapshot? {
      val json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return null
      return runCatching { parse(json) }.getOrNull()
    }
  }
}
