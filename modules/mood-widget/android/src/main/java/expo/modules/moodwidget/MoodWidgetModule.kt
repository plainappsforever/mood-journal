package expo.modules.moodwidget

import android.appwidget.AppWidgetManager
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The app pushes the widget snapshot; More offers the launcher's "Add to home screen". */
class MoodWidgetModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MoodWidget")

    Function("setData") { json: String ->
      Snapshot.save(context, json)
      MoodWidgetProvider.refresh(context)
    }

    Function("widgetCount") { MoodWidgetProvider.widgetIds(context).size }

    Function("requestPinWidget") {
      if (MoodWidgetProvider.widgetIds(context).isNotEmpty()) return@Function "alreadyAdded"
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function "unsupported"
      val manager = context.getSystemService(AppWidgetManager::class.java)
      if (manager == null || !manager.isRequestPinAppWidgetSupported) return@Function "unsupported"
      if (manager.requestPinAppWidget(MoodWidgetProvider.componentName(context), null, null)) "requested" else "unsupported"
    }
  }
}
