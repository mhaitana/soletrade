const fs = require("node:fs/promises");
const path = require("node:path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const RECEIVER = ".widgets.SoletradeQuickActionsWidget";
function androidSettings(config) {
  const packageName = config.android?.package;
  const scheme = Array.isArray(config.scheme) ? config.scheme[0] : config.scheme;
  if (!packageName || !/^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)+$/.test(packageName))
    throw new Error("Soletrade quick widget requires a valid android.package.");
  if (!scheme || !/^[a-z][a-z0-9+.-]*$/.test(scheme))
    throw new Error("Soletrade quick widget requires an explicit app scheme.");
  return { packageName, scheme };
}
function applyManifest(manifest) {
  const application = manifest.manifest.application?.[0];
  if (!application) throw new Error("Android manifest application is missing.");
  application.receiver = (application.receiver ?? []).filter(
    (receiver) => receiver.$?.["android:name"] !== RECEIVER,
  );
  application.receiver.push({
    $: {
      "android:name": RECEIVER,
      "android:exported": "false",
      "android:label": "@string/soletrade_quick_widget_name",
    },
    "intent-filter": [
      { action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }] },
    ],
    "meta-data": [
      {
        $: {
          "android:name": "android.appwidget.provider",
          "android:resource": "@xml/soletrade_quick_widget_info",
        },
      },
    ],
  });
  return manifest;
}
function androidFiles(config) {
  const { packageName, scheme } = androidSettings(config);
  const kotlin = `package ${packageName}.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.RemoteViews
import ${packageName}.MainActivity
import ${packageName}.R

/** Static, private-data-free actions work even when the JavaScript process is absent. */
class SoletradeQuickActionsWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    ids.forEach { id -> update(context, manager, id) }
  }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    update(context, manager, id)
  }

  private fun update(context: Context, manager: AppWidgetManager, widgetId: Int) {
    val views = RemoteViews(context.packageName, R.layout.soletrade_quick_widget)
    views.setOnClickPendingIntent(R.id.soletrade_quick_shift, launch(context, widgetId, 0, "${scheme}://feature/shift"))
    views.setOnClickPendingIntent(R.id.soletrade_quick_receipt, launch(context, widgetId, 1, "${scheme}://feature/receipt"))
    views.setOnClickPendingIntent(R.id.soletrade_quick_invoice, launch(context, widgetId, 2, "${scheme}://edit/invoices/new"))
    manager.updateAppWidget(widgetId, views)
  }

  private fun launch(context: Context, widgetId: Int, actionIndex: Int, url: String): PendingIntent {
    // Distinct request codes AND data avoid one action replacing another's pending intent.
    val requestCode = widgetId * 4 + actionIndex
    val uri = Uri.parse(url).buildUpon().appendQueryParameter("sourceWidget", widgetId.toString()).build()
    val intent = Intent(context, MainActivity::class.java).apply {
      action = Intent.ACTION_VIEW
      data = uri
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
}
`;
  const layout = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent" android:layout_height="match_parent"
  android:orientation="vertical" android:padding="12dp" android:background="@drawable/soletrade_quick_widget_background">
  <TextView android:layout_width="match_parent" android:layout_height="wrap_content" android:text="@string/soletrade_quick_widget_name" android:textSize="18sp" android:textStyle="bold" android:textColor="#192b3c" />
  <TextView android:layout_width="match_parent" android:layout_height="wrap_content" android:text="@string/soletrade_quick_widget_privacy" android:textSize="12sp" android:textColor="#405367" />
  <Button android:id="@+id/soletrade_quick_shift" android:layout_width="match_parent" android:layout_height="wrap_content" android:minHeight="48dp" android:text="@string/soletrade_quick_widget_shift" android:textAllCaps="false" />
  <Button android:id="@+id/soletrade_quick_receipt" android:layout_width="match_parent" android:layout_height="wrap_content" android:minHeight="48dp" android:text="@string/soletrade_quick_widget_receipt" android:textAllCaps="false" />
  <Button android:id="@+id/soletrade_quick_invoice" android:layout_width="match_parent" android:layout_height="wrap_content" android:minHeight="48dp" android:text="@string/soletrade_quick_widget_invoice" android:textAllCaps="false" />
</LinearLayout>
`;
  const info = `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
  android:minWidth="200dp" android:minHeight="210dp" android:minResizeWidth="180dp" android:minResizeHeight="210dp"
  android:targetCellWidth="3" android:targetCellHeight="3" android:updatePeriodMillis="0"
  android:initialLayout="@layout/soletrade_quick_widget" android:previewLayout="@layout/soletrade_quick_widget"
  android:description="@string/soletrade_quick_widget_description" android:resizeMode="horizontal|vertical" android:widgetCategory="home_screen" />
`;
  const strings = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="soletrade_quick_widget_name">Soletrade quick actions</string>
  <string name="soletrade_quick_widget_privacy">Choose your workspace in the app</string>
  <string name="soletrade_quick_widget_description">Open receipt capture, shift recording or a new invoice</string>
  <string name="soletrade_quick_widget_shift">Start shift</string>
  <string name="soletrade_quick_widget_receipt">Capture receipt</string>
  <string name="soletrade_quick_widget_invoice">New invoice</string>
</resources>
`;
  const background = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#f7f5f0"/><corners android:radius="18dp"/></shape>
`;
  return {
    [`java/${packageName.replaceAll(".", "/")}/widgets/SoletradeQuickActionsWidget.kt`]: kotlin,
    "res/layout/soletrade_quick_widget.xml": layout,
    "res/xml/soletrade_quick_widget_info.xml": info,
    "res/values/soletrade_quick_widget_strings.xml": strings,
    "res/drawable/soletrade_quick_widget_background.xml": background,
  };
}
async function writeAndroidFiles(config, platformProjectRoot) {
  for (const [relative, content] of Object.entries(androidFiles(config))) {
    const destination = path.join(platformProjectRoot, "app", "src", "main", relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, "utf8");
  }
}
function withAndroidQuickWidget(config) {
  androidSettings(config);
  config = withAndroidManifest(config, (mod) => {
    mod.modResults = applyManifest(mod.modResults);
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    async (mod) => {
      await writeAndroidFiles(mod, mod.modRequest.platformProjectRoot);
      return mod;
    },
  ]);
}
module.exports = withAndroidQuickWidget;
module.exports.androidFiles = androidFiles;
module.exports.applyManifest = applyManifest;
module.exports.writeAndroidFiles = writeAndroidFiles;
