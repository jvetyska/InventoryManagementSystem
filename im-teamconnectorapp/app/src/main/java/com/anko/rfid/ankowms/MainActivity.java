package com.anko.rfid.ankowms;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.SoundPool;
import android.net.http.SslError;
import android.os.AsyncTask;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.util.Log;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.CheckBox;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.gson.Gson;
import com.zebra.rfid.api3.InvalidUsageException;
import com.zebra.rfid.api3.OperationFailureException;
import com.zebra.rfid.api3.TagData;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import static android.provider.ContactsContract.Intents.Insert.ACTION;
import org.ini4j.*;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class MainActivity extends AppCompatActivity {

    private static final String LOG_TAG = "MainActivity" ;
    private static final String TAG = "MainActivity";
    private WebView _webView;
    private TextView _appVersionView;
    RFIDHandler rfidHandler;
    HashMap<String, String> epcBarcodeMap = new HashMap<String, String>();
    ConcurrentHashMap<String, Product> productHashMap = new ConcurrentHashMap<String, Product>();
    ConcurrentHashMap<String, Integer> tempProducts = new ConcurrentHashMap<String, Integer>();
    private final int proxyPORT = 8080;
    private final String proxyURL = "httpgw-tll.kmtltd.net.au";
    private boolean barcodeFromRFDHandle = true;
    private boolean rfidInTriggerMode = true;
    private boolean rfidSessionActive = false;
    // DataWedge Extras
    private static final String EXTRA_PROFILENAME = "TeamConnectorProfile";
    private static final String EXTRA_PROFILENAME_WO_RFID = "TeamConnectorProfileSimple";
    private static final String EXTRA_GET_VERSION_INFO = "com.symbol.datawedge.api.GET_VERSION_INFO";
    private static final String EXTRA_CREATE_PROFILE = "com.symbol.datawedge.api.CREATE_PROFILE";
    private static final String EXTRA_KEY_APPLICATION_NAME = "com.symbol.datawedge.api.APPLICATION_NAME";
    private static final String EXTRA_KEY_NOTIFICATION_TYPE = "com.symbol.datawedge.api.NOTIFICATION_TYPE";
    private static final String EXTRA_SOFT_SCAN_TRIGGER = "com.symbol.datawedge.api.SOFT_SCAN_TRIGGER";
    private static final String EXTRA_RESULT_NOTIFICATION = "com.symbol.datawedge.api.NOTIFICATION";
    private static final String EXTRA_REGISTER_NOTIFICATION = "com.symbol.datawedge.api.REGISTER_FOR_NOTIFICATION";
    private static final String EXTRA_UNREGISTER_NOTIFICATION = "com.symbol.datawedge.api.UNREGISTER_FOR_NOTIFICATION";
    private static final String EXTRA_SET_CONFIG = "com.symbol.datawedge.api.SET_CONFIG";
    private static final String EXTRA_RESULT_NOTIFICATION_TYPE = "NOTIFICATION_TYPE";
    private static final String EXTRA_KEY_VALUE_SCANNER_STATUS = "SCANNER_STATUS";
    private static final String EXTRA_KEY_VALUE_PROFILE_SWITCH = "PROFILE_SWITCH";
    private static final String EXTRA_KEY_VALUE_CONFIGURATION_UPDATE = "CONFIGURATION_UPDATE";
    private static final String EXTRA_KEY_VALUE_NOTIFICATION_STATUS = "STATUS";
    private static final String EXTRA_KEY_VALUE_NOTIFICATION_PROFILE_NAME = "PROFILE_NAME";
    private static final String EXTRA_SEND_RESULT = "SEND_RESULT";
    private static final String EXTRA_EMPTY = "";
    private static final String EXTRA_RESULT_GET_VERSION_INFO = "com.symbol.datawedge.api.RESULT_GET_VERSION_INFO";
    private static final String EXTRA_RESULT = "RESULT";
    private static final String EXTRA_RESULT_INFO = "RESULT_INFO";
    private static final String EXTRA_COMMAND = "COMMAND";
    // DataWedge Actions
    private static final String ACTION_DATAWEDGE = "com.symbol.datawedge.api.ACTION";
    private static final String ACTION_RESULT_NOTIFICATION = "com.symbol.datawedge.api.NOTIFICATION_ACTION";
    private static final String ACTION_RESULT = "com.symbol.datawedge.api.RESULT_ACTION";
    // customdata.ini file location
    private static final String CUSTOMDATA_INI_FILE = "/enterprise/usr/persist/Kmart/customdata.ini";
    // private variables
    private Boolean bRequestSendResult = false;
    private Boolean continuousScanON = false;
    private boolean hybridMode = false;
    private boolean rfidMode = false;
    private boolean barcodeMode = true;
    private boolean bondingInProgress = false;
    BroadcastReceiver mReceiver;
    PowerManager pm;
    SoundPool soundPool;
    int newTagSound;
    int connectSound;
    int btConnectedSound;
    int btDisconnectedSound;
    int btDevFoundSound;
    int btDevPairedSound;
    private static BluetoothAdapter mBTAdapter;
    private Set<BluetoothDevice> mPairedDevices;
    // private BluetoothDeviceManager btDevMan;
    private static BTDeviceManager btDevMan;
    private final static int REQUEST_ENABLE_BT = 1;
    private final static String RFD8500_PREFIX = "RFD8500";
    private String connectedToReader = "";
    private KmartDeviceInfo kmartDeviceInfo;
    APIInterface apiInterface;
    private String currentWebviewURL = "";
    enum BTDEVSTATUS {
        PAIRED,
        CONNECTED,
        DISCONNECTED,
        DISCOVERED,
        UNKNOWN
    };
    enum BTMessageTypes {
        PAIRED {
            public String toString() {
                return "dev_paired";
            }
        },
        FOUND {
            public String toString () {
                return "dev_found";
            }
        },
        PAIRED_SUCCESS {
          public String toString () {
              return "dev_paired_success";
          }
        },
        STATUS {
            public String toString () {
                return "dev_status";
            }
        },
        DELETED {
            public String toString () {
                return "dev_unpaired";
            }
        },
        DISCOVERY_ENDED {
            public String toString () {
                return "discovery_ended";
            }
        },
        DISCOVERY_STARTED {
            public String toString () {
                return "discovery_started";
            }
        }
    }
    enum UserResponseType {
        YES {
            public String toString() {
                return "YES";
            }
        },
        NO {
            public String toString() {
                return "NO";
            }
        },
        NOT_USING_RFD8500 {
            public String toString() {
                return "IGNORE";
            }
        }
    }


    private AlertDialog alertDialog;
    UserResponseType rfd8500ConnDialogResponse = UserResponseType.YES;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // setup Logging here
        if ( isExternalStorageWritable() ) {
            // if you are looking to pull logs from the physical development device
            // adb pull /sdcard/Android/data/com.anko.rfid.ankowms/files/ATeamConnectorApp/logs/logcat_xxxxxxxxxx.txt   ~/log_folder_on_my_pc
            // On production device use SOTI and copy/paste
            File appDirectory = new File( getExternalFilesDir(null) + "/ATeamConnectorApp" );
            File logDirectory = new File( appDirectory + "/logs" );
            Log.d(TAG, "LOG: " + logDirectory.getAbsolutePath());
            File logFile = new File( logDirectory, "logcat_" + System.currentTimeMillis() + ".txt" );
            // create app folder
            if ( !appDirectory.exists() ) {
                appDirectory.mkdir();
            }
            // create log folder
            if ( !logDirectory.exists() ) {
                logDirectory.mkdir();
            }
            // clear the previous logcat and then write the new one to the file
            try {
                Process process = Runtime.getRuntime().exec("logcat -c");
                process = Runtime.getRuntime().exec("logcat -f " + logFile);
            } catch ( IOException e ) {
                e.printStackTrace();
            }
        } else if ( isExternalStorageReadable() ) {
            Log.d(TAG, "LOG: ONLY READABLE");
        } else {
            Log.d(TAG, "LOG: NOT ACCESSIBLE");
        }
        setupSound();
        createDialog(connectedToReader);
        apiInterface = ApiClient.getClient().create(APIInterface.class);
        // INITIALIZE RECEIVER
        IntentFilter filter = new IntentFilter(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
        filter.addAction(BluetoothDevice.ACTION_FOUND);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_STARTED);
        filter.addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED);
        filter.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
        mReceiver = new ApplicationBroadcastReceiver(this);
        registerReceiver(mReceiver, filter);
        pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        kmartDeviceInfo = new KmartDeviceInfo();
        //this.getSupportActionBar().hide();
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setContentView(R.layout.activity_main);
        // setting up bluetooth
        mBTAdapter = BluetoothAdapter.getDefaultAdapter();
        btDevMan = new BTDeviceManager();
        // Ask for location permission if not already allowed
        if(ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.ACCESS_COARSE_LOCATION}, 1);
        }
        rfidHandler = new RFIDHandler();
        rfidHandler.onCreate(this);
        // new RFIDConnectionTask().execute();
        new Thread(new Runnable()
                {
                    @Override
                    public void run() {
                        System.out.println("blah");
                        new ReadIniFileAsyncTask().execute(CUSTOMDATA_INI_FILE);
                        setupBluetooth();
                    }
                }).start();
        _webView = (WebView) findViewById(R.id.webview);
        _appVersionView = (TextView) findViewById(R.id.appVersionStr);
        String versionStr = "v" + BuildConfig.VERSION_NAME + "." +BuildConfig.VERSION_CODE;
        _appVersionView.setText(versionStr);
        initializeWebView(_webView);
        //_webView.loadUrl(BuildConfig.BASEURL);
        setBDFPluginConfig();
        setKeystrokeOutputPluginConfig();
    }

    public String getDeviceInfo () {
        Gson gson = new Gson();
        String json = gson.toJson(kmartDeviceInfo);
        Log.d(TAG, "KmartDeviceInfo: " + json);
        return json;
    }
    public boolean InitRFID() {
        boolean flag = false;
        try {
            if(!rfidHandler.isReaderConnected()) {
                rfidHandler.InitSDK();
                Log.i(LOG_TAG, "RFID Connected successfully");
                flag = true;
            } else {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        errorFromAndroidToWebview("true");
                    }
                });
            }
        } catch (Exception e) {
            Log.d(TAG, e.getMessage());
        }
        return flag;
    }
    public void setDecoderOptions() {
        CreateProfile();
        String Code128Value = "true";
        String Code39Value = "true";
        String EAN13Value = "true";
        String UPCAValue = "true";
        // Main bundle properties
        Bundle profileConfig = new Bundle();
        profileConfig.putString("PROFILE_NAME", EXTRA_PROFILENAME);
        profileConfig.putString("PROFILE_ENABLED", "true");
        profileConfig.putString("CONFIG_MODE", "UPDATE");  // Update specified settings in profile
        // PLUGIN_CONFIG bundle properties
        Bundle barcodeConfig = new Bundle();
        barcodeConfig.putString("PLUGIN_NAME", "BARCODE");
        barcodeConfig.putString("RESET_CONFIG", "true");
        // PARAM_LIST bundle properties
        Bundle barcodeProps = new Bundle();
        barcodeProps.putString("scanner_selection", "auto");
        barcodeProps.putString("scanner_input_enabled", "true");
        barcodeProps.putString("decoder_code128", Code128Value);
        barcodeProps.putString("decoder_code39", Code39Value);
        barcodeProps.putString("decoder_ean13", EAN13Value);
        barcodeProps.putString("decoder_upca", UPCAValue);
        // Bundle "barcodeProps" within bundle "barcodeConfig"
        barcodeConfig.putBundle("PARAM_LIST", barcodeProps);
        // Place "barcodeConfig" bundle within main "profileConfig" bundle
        profileConfig.putBundle("PLUGIN_CONFIG", barcodeConfig);
        // Create APP_LIST bundle to associate app with profile
        Bundle appConfig = new Bundle();
        appConfig.putString("PACKAGE_NAME", getPackageName());
        appConfig.putStringArray("ACTIVITY_LIST", new String[]{"*"});
        profileConfig.putParcelableArray("APP_LIST", new Bundle[]{appConfig});
        sendDataWedgeIntentWithExtra(ACTION_DATAWEDGE, EXTRA_SET_CONFIG, profileConfig);
        // Register for status change notification
        // Use REGISTER_FOR_NOTIFICATION: http://techdocs.zebra.com/datawedge/latest/guide/api/registerfornotification/
        Bundle b = new Bundle();
        b.putString(EXTRA_KEY_APPLICATION_NAME, getPackageName());
        b.putString(EXTRA_KEY_NOTIFICATION_TYPE, "SCANNER_STATUS");     // register for changes in scanner status
        sendDataWedgeIntentWithExtra(ACTION_DATAWEDGE, EXTRA_REGISTER_NOTIFICATION, b);
        registerReceivers();
        // Get DataWedge version
        // Use GET_VERSION_INFO: http://techdocs.zebra.com/datawedge/latest/guide/api/getversioninfo/
        sendDataWedgeIntentWithExtra(ACTION_DATAWEDGE, EXTRA_GET_VERSION_INFO, EXTRA_EMPTY);    // must be called after registering BroadcastReceiver
    }
    private void initializeWebView(WebView webView) {
        if ( BuildConfig.FLAVOR.equals("ANKO") && BuildConfig.BUILD_TYPE.equals("debug")) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                WebView.setWebContentsDebuggingEnabled(true);
            }
        }
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        webView.getSettings().setAllowContentAccess(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowFileAccessFromFileURLs(true);
        webView.getSettings().setAllowUniversalAccessFromFileURLs(true);
        webView.getSettings().setLoadWithOverviewMode(true);
        webView.getSettings().setUseWideViewPort(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setSupportZoom(true);
        webView.getSettings().setBuiltInZoomControls(true);
        webView.getSettings().setDisplayZoomControls(false);
        webView.setSoundEffectsEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.setWebViewClient(new WebViewClient(){

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.proceed();
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                findViewById(R.id.webview).setVisibility(View.VISIBLE);
                findViewById(R.id.imgView).setVisibility(View.GONE);
                findViewById(R.id.progressBar2).setVisibility(View.GONE);
                _appVersionView.setVisibility(View.GONE);
                view.clearFocus();
                view.requestFocus();
               super.onPageFinished(view, url);
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                Log.d(TAG, "RECEIVED ERROR on REQUEST: " + request.getMethod() + " " + request.getUrl());
                super.onReceivedError(view, request, error);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                Log.d(TAG, "HTTP ERROR on REQUEST: " + request.getMethod() + " " + request.getUrl() + " ERROR: " + errorResponse.getReasonPhrase());
                super.onReceivedHttpError(view, request, errorResponse);
            }
        });
        if(BuildConfig.SETPROXY) {
            //WebviewSettingProxy.setProxyLollipop (webView, proxyURL, proxyPORT, "android.app.Application");
        }
        webView.addJavascriptInterface(new WebAppInterface(this), "WebAppInterface");
        webView.clearCache(true);
        // This removes the localstorage which has the entry
        // for user login and if valid
        // WebStorage.getInstance().deleteAllData();
        webView.requestFocus(View.FOCUS_UP|View.FOCUS_DOWN);
    }
    public void enableHybridMode() {
        if(!barcodeFromRFDHandle) {
            hybridMode = true;
        }
    }
    public void cancelHybridMode() {
        if (!barcodeFromRFDHandle) {
            hybridMode = false;
        }
    }
    public void disconnectRFIDScanner() {
        rfidHandler.disconnect();
    }
    public  void connectRFIDScanner() {
        rfidHandler.connect();
    }
    public  void disableRFIDMode() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    rfidHandler.setTriggerModeBarcode();
                } catch (InvalidUsageException e) {
                    e.printStackTrace();
                } catch (OperationFailureException e) {
                    e.printStackTrace();
                }
            }
        });

    }
    public  void enableRFIDMode() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    rfidHandler.setTriggerModeRFID();
                } catch (InvalidUsageException e) {
                    e.printStackTrace();
                } catch (OperationFailureException e) {
                    e.printStackTrace();
                }
            }
        });
    }
    public void enableSession() {
        rfidSessionActive = true;
    }
    public void updateConnectedToReaderVar(String readerHostName) {
        Log.d(TAG, "updated connectedToReader variable with " + readerHostName);
        connectedToReader = readerHostName;
        if (!connectedToReader.equals("")) {
            alertDialog.setTitle("Connected to " + connectedToReader);
            alertDialog.show();
        }
    }
    private void createDialog(String readerHostName) {
        AlertDialog.Builder alertDialogBuilder = new AlertDialog.Builder(this, R.style.MyDialogTheme);
        alertDialogBuilder.setTitle("Connected to " + readerHostName);
        alertDialogBuilder.setMessage("Is it correct ?");
        alertDialogBuilder.setNeutralButton ("No RFD8500", new DialogInterface.OnClickListener() {
            public void onClick(DialogInterface dialog, int id) {
                rfd8500ConnDialogResponse = UserResponseType.NOT_USING_RFD8500;
                rfidHandler.disconnect();
            }
        });
        alertDialogBuilder.setPositiveButton("Yes", new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialogInterface, int i) {
                rfd8500ConnDialogResponse = UserResponseType.YES;
            }
        });
        alertDialogBuilder.setNegativeButton ( "No", new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialogInterface, int i) {
                rfd8500ConnDialogResponse = UserResponseType.NO;
                rfidHandler.disconnect();
            }
        });
        alertDialog = alertDialogBuilder.create();
    }
    public void disableSession() {
        epcBarcodeMap.clear();
        productHashMap.clear();
        tempProducts.clear();
        rfidSessionActive = false;
    }
    public void performRFIDInventory() {
        continuousScanON = true;
        rfidHandler.performInventory();
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                setRFIDInTriggerMode(false);
            }
        });
    }
    public void stopRFIDInventory() {
        continuousScanON = false;
        rfidHandler.stopInventory();
        // we clear this  - because when 
        // continuousScanON we use epcBarcodeMap as a session variable to
        // keep track of all the epcs that we have seen
        // during this time
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                setRFIDInTriggerMode(true);
                Gson gson = new Gson();
                if(!productHashMap.isEmpty()) {
                    String json = gson.toJson(productHashMap);
                    Log.d(TAG, "Sendding GSON PRODUCT LIST ");
                    dataFromAndroidToWebview(json);
                    // productHashMap.clear();
                }
            }
        });
    }
    public void setRFIDInTriggerMode(boolean value) {
        rfidInTriggerMode = value;
        sendRFIDStatusToWebView(!value); // front-end expects the opposite value of what the variable rfidTriggerMode is set to
    }
    public void rfidFromRFDTrigger() {
        barcodeFromRFDHandle = false;
        barcodeMode = false;
        rfidMode = true;
    }
    public void barcodeFromRFDTrigger() {
        barcodeFromRFDHandle = true;
        rfidMode = false;
        barcodeMode = true;
    }
    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        MenuInflater inflater = getMenuInflater();
        inflater.inflate(R.menu.main_menu, menu);
        return true;
    }
    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        // Handle item selection
        switch (item.getItemId()) {
            case R.id.action_rfid:
                enableRFIDMode();
                return true;
            case R.id.action_barcode:
                disableRFIDMode();
                return true;
            case R.id.action_settings:
                return true;
            default:
                return super.onOptionsItemSelected(item);
        }
    }
    @Override
    protected void onPostCreate(Bundle savedInstanceState) {
        super.onPostCreate(savedInstanceState);
    }
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (!rfidHandler.connectionErrStatus()) {
            if (rfidMode || continuousScanON) {
                stopRFIDInventory();
                continuousScanON = false;
            }
            rfidHandler.onPause();
            playConnectSound();
        }
    }
    @Override
    protected void onPause() {
        super.onPause();
        if (pm.isScreenOn()) {
            Log.d(TAG, "onPause SCREEN is ON");
        } else {
            Log.d(TAG, "onPause SCREEN is OFF");
            if (!rfidHandler.connectionErrStatus()) {
                if (rfidMode || continuousScanON) {
                    stopRFIDInventory();
                    continuousScanON = false;
                }
                rfidHandler.onPause();
                // playConnectSound();
            }
        }
        //unregisterReceiver(myBroadcastReceiver);
        //unRegisterScannerStatus();
    }
    @Override
    protected void onPostResume() {
        super.onPostResume();
        //String status = rfidHandler.onResume();
        //statusTextViewRFID.setText(status);
    }
    @Override
    protected void onResume() {
        super.onResume();
        if (pm.isScreenOn()) {
            Log.d(TAG, "onResume SCREEN is ON");
            if (!rfidHandler.connectionErrStatus()) {
                rfidHandler.onResume();
                playConnectSound();
            }
        } else {
            Log.d(TAG, "onResume SCREEN is OFF");
        }
    }
    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (rfidMode || continuousScanON) {
            stopRFIDInventory();
            continuousScanON = false;
        }
        rfidHandler.onDestroy();
        unregisterReceiver(mReceiver);
    }
    @Override
    protected void onRestoreInstanceState(@NonNull Bundle savedInstanceState) {
        super.onRestoreInstanceState(savedInstanceState);
        barcodeFromRFDHandle = savedInstanceState.getBoolean("barcodeFromRFDHandle", false);
    }
    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putBoolean("barcodeFromRFDHandle", barcodeFromRFDHandle);
    }

    /**
     * This function is called by the RFID Handler class to
     * this function whenever data becomes available
     * */
    public synchronized  void handleTagdata (TagData[] tagData) {
        //tempProducts.clear(); // flush HashMap every time we get a new load of data
        if (hybridMode) {
            return;
        }
        for (int index = 0; index < tagData.length; index++) {
            String rfidTagID = tagData[index].getTagID();
            String productSKU = "barcode";
            // epc(s) -> barcode combo gets appended
            // to webMsg only when they don't exist in epcBarcodeMap
            // In case continuousScanON, the epcBarcodeMap is not cleared on trigger release
            if(epcBarcodeMap.containsKey(rfidTagID) == false && rfidTagID != null && rfidTagID.startsWith("30")) {
                Sgtin96 sgtin96 = Sgtin96.FromSgtin96Epc(rfidTagID);
                soundPool.play(newTagSound, 1, 1, 0, 0, 1);
                productSKU = sgtin96.toEAN();
                if(productHashMap.containsKey(productSKU) == false) {
                    Product p = new Product(productSKU, rfidTagID); // create obj
                    productHashMap.put(productSKU, p); // assign object in HashMap
                    tempProducts.put(productSKU, 1); // init temp HashMap with qty 1
                } else {
                    productHashMap.get(productSKU).setEpcList(rfidTagID); // adding the epc list to the already existing object
                    int currentQuantity = productHashMap.get(productSKU).getQuantity(); // get current quantity after adding the epc
                    tempProducts.put(productSKU, currentQuantity); // update the temporary HashMap
                }
                epcBarcodeMap.put(rfidTagID, productSKU);
            }
        }
        if(!epcBarcodeMap.isEmpty()) {
            // this will keep pushing the data it becomes available
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Gson gson = new Gson();
                    if(!tempProducts.isEmpty()) {
                        String json = gson.toJson(tempProducts);
                        Log.d(TAG, "GSON " + json);
                        dataFromAndroidToWebview(json);
                        tempProducts.clear();
                    }
                }
            });
        }
    }
    public void handleTriggerPress(boolean pressed) {
        // scenario 1 - continuousScanON and trigger pressed
        // scenario 2 - !continuousScanON and trigger pressed
        if (pressed) {
            if(barcodeFromRFDHandle || hybridMode) {
                // ToggleSoftScanTrigger();
                StartSoftScanTrigger();
            } else {
                // need to make a better way to handle this
                if(!continuousScanON) {
                    rfidHandler.performInventory();
                    runOnUiThread(new Runnable(){
                        @Override
                        public void run() {
                            sendRFIDStatusToWebView(true);
                        }
                    });
                }
            }
        } else { // trigger released
            // if rfidSessionActive then we don't want to clear this
            if(!rfidSessionActive) {
                epcBarcodeMap.clear();
                productHashMap.clear();
                tempProducts.clear();
            }
            if(barcodeFromRFDHandle || hybridMode) {
                StopSoftScanTrigger();
            } else { // trigger in rfid mode
                rfidHandler.stopInventory();
                if(continuousScanON) {
                    continuousScanON = false;
                }
                // need to make a better way to handle this
                runOnUiThread(new Runnable(){
                    @Override
                    public void run() {
                        sendRFIDStatusToWebView(false);
                        Gson gson = new Gson();
                        if(!productHashMap.isEmpty()) {
                            String json = gson.toJson(productHashMap);
                            Log.d(TAG, "GSON PRODUCT LIST " + json);
                            dataFromAndroidToWebview(json);
                        }
                    }
                });
            }
        }
    }
    public void sendDataToWebView(String webMsg) {
        String jsSting = "MakeMeHappy('" + webMsg + "')";
        _webView.evaluateJavascript(
                "javascript:" + jsSting,
                null
        );

    }
    public void sendBluetoothData(String type, String msg) {
        Log.d(TAG, msg);
        String jsSting = "sendBTData('"+ type + "','" + msg + "')";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                _webView.evaluateJavascript(
                        "javascript:" + jsSting,
                        null
                );
            }
        });
    }
    public void dataFromAndroidToWebview(String msg) {
        Log.d(TAG, msg);
        String jsSting = "recvData('" + msg + "')";
        _webView.evaluateJavascript(
                "javascript:" + jsSting,
                null
        );
    }
    public void errorFromAndroidToWebview(String msg) {
        String jsSting = "rfidconnected('" + msg + "')";
        _webView.evaluateJavascript(
                "javascript:" + jsSting,
                null
        );
    }
    public void sendRFIDStatusToWebView(boolean flag) {
        String jsSting = "rfidtriggerstatus('" + flag + "')";
        _webView.evaluateJavascript(
                "javascript:" + jsSting,
                null
                );
    }
    public void sendAntennaConfig (String config) {
        Log.d(TAG, "RF Antenna Config " + config);;
        String jsSting = "configData('" + config + "')";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                _webView.evaluateJavascript(
                        "javascript:" + jsSting,
                        null
                        );
            }
        });
    }
    public void CreateProfile (){
        String profileName = EXTRA_PROFILENAME;
        // Send DataWedge intent with extra to create profile
        // Use CREATE_PROFILE: http://techdocs.zebra.com/datawedge/latest/guide/api/createprofile/
        sendDataWedgeIntentWithExtra(ACTION_DATAWEDGE, EXTRA_CREATE_PROFILE, profileName);
        // Configure created profile to apply to this app
        Bundle profileConfig = new Bundle();
        profileConfig.putString("PROFILE_NAME", EXTRA_PROFILENAME);
        profileConfig.putString("PROFILE_ENABLED", "true");
        profileConfig.putString("CONFIG_MODE", "CREATE_IF_NOT_EXIST");  // Create profile if it does not exist
        // Configure barcode input plugin
        Bundle barcodeConfig = new Bundle();
        barcodeConfig.putString("PLUGIN_NAME", "BARCODE");
        barcodeConfig.putString("RESET_CONFIG", "true"); //  This is the default
        Bundle barcodeProps = new Bundle();
        barcodeConfig.putBundle("PARAM_LIST", barcodeProps);
        profileConfig.putBundle("PLUGIN_CONFIG", barcodeConfig);
        // Associate profile with this app
        Bundle appConfig = new Bundle();
        appConfig.putString("PACKAGE_NAME", getPackageName());
        appConfig.putStringArray("ACTIVITY_LIST", new String[]{"*"});
        profileConfig.putParcelableArray("APP_LIST", new Bundle[]{appConfig});
        profileConfig.remove("PLUGIN_CONFIG");
        // Apply configs
        // Use SET_CONFIG: http://techdocs.zebra.com/datawedge/latest/guide/api/setconfig/
        sendDataWedgeIntentWithExtra(ACTION_DATAWEDGE, EXTRA_SET_CONFIG, profileConfig);
        // Configure intent output for captured data to be sent to this app
        Bundle intentConfig = new Bundle();
        intentConfig.putString("PLUGIN_NAME", "INTENT");
        intentConfig.putString("RESET_CONFIG", "true");
        Bundle intentProps = new Bundle();
        intentProps.putString("intent_output_enabled", "true");
        intentProps.putString("intent_action", "com.zebra.datacapture1.ACTION");
        intentProps.putString("intent_delivery", "2");
        intentConfig.putBundle("PARAM_LIST", intentProps);
        profileConfig.putBundle("PLUGIN_CONFIG", intentConfig);
        //sendDataWedgeIntentWithExtra(ACTION_DATAWEDGE, EXTRA_SET_CONFIG, profileConfig);
    }
    public void DeleteProfile() {
        Intent i = new Intent();
        i.setAction("com.symbol.datawedge.api.ACTION");
        String[] values = {EXTRA_PROFILENAME};
        i.putExtra("com.symbol.datawedge.api.DELETE_PROFILE", values);
        this.sendBroadcast(i);
    }
    public void setBDFPluginConfig() {
        // Main bundle properties
        Bundle bMain = new Bundle();
        bMain.putString("PROFILE_NAME", EXTRA_PROFILENAME);
        bMain.putString("PROFILE_ENABLED","true");
        bMain.putString("CONFIG_MODE","CREATE_IF_NOT_EXIST");
        // plugin_config bundle properties
        Bundle bConfig = new Bundle();
        bConfig.putString("PLUGIN_NAME","BDF");
        bConfig.putString("RESET_CONFIG","true");
        bConfig.putString("OUTPUT_PLUGIN_NAME","KEYSTROKE");
        // param_list bundle properties
        Bundle bParams = new Bundle();
        bParams.putString("bdf_enabled","true");
        // bParams.putString("bdf_prefix","AAA");
        bParams.putString("bdf_send_enter","true");
        bConfig.putBundle("PARAM_LIST", bParams);
        bMain.putBundle("PLUGIN_CONFIG", bConfig);
        sendDataWedgeIntentWithExtra(ACTION_DATAWEDGE, EXTRA_SET_CONFIG, bMain);
        // Associate profile with this app
        Bundle appConfig = new Bundle();
        appConfig.putString("PACKAGE_NAME", getPackageName());
        appConfig.putStringArray("ACTIVITY_LIST", new String[]{"*"});
        bMain.putParcelableArray("APP_LIST", new Bundle[]{appConfig});
        bMain.remove("PLUGIN_CONFIG");
        sendDataWedgeIntentWithExtra(ACTION_DATAWEDGE, EXTRA_SET_CONFIG, bMain);
    }
    public void setKeystrokeOutputPluginConfig() {
        Bundle configBundle = new Bundle();
        configBundle.putString("PROFILE_NAME", EXTRA_PROFILENAME);
        configBundle.putString("PROFILE_ENABLED","true");
        configBundle.putString("CONFIG_MODE","CREATE_IF_NOT_EXIST");

        Bundle bConfig = new Bundle();

        bConfig.putString("PLUGIN_NAME", "KEYSTROKE");
        Bundle bParams = new Bundle();
        bParams.putString("keystroke_output_enabled","true");
        bParams.putString("keystroke_character_delay","5");
        // bParams.putString("keystroke_action_char","9"); // 0, 9 , 10, 13
        //bParams.putString("keystroke_delay_extended_ascii","500");
        //bParams.putString("keystroke_delay_control_chars","800");
        bConfig.putBundle("PARAM_LIST", bParams);
        configBundle.putBundle("PLUGIN_CONFIG", bConfig);
        sendDataWedgeIntentWithExtra(ACTION_DATAWEDGE, EXTRA_SET_CONFIG, configBundle);

        // Associate profile with this app
        Bundle appConfig = new Bundle();
        appConfig.putString("PACKAGE_NAME", getPackageName());
        appConfig.putStringArray("ACTIVITY_LIST", new String[]{"*"});
        configBundle.putParcelableArray("APP_LIST", new Bundle[]{appConfig});
        configBundle.remove("PLUGIN_CONFIG");
        sendDataWedgeIntentWithExtra(ACTION_DATAWEDGE, EXTRA_SET_CONFIG, configBundle);
        
    }
    // Toggle soft scan trigger from UI onClick() event
    // Use SOFT_SCAN_TRIGGER: http://techdocs.zebra.com/datawedge/latest/guide/api/softscantrigger/
    public void ToggleSoftScanTrigger (){
        sendDataWedgeIntentWithExtra(ACTION_DATAWEDGE, EXTRA_SOFT_SCAN_TRIGGER, "TOGGLE_SCANNING");
    }
    public void StartSoftScanTrigger (){
        sendDataWedgeIntentWithExtra(ACTION_DATAWEDGE, EXTRA_SOFT_SCAN_TRIGGER, "START_SCANNING");
    }
    public void StopSoftScanTrigger (){
        sendDataWedgeIntentWithExtra(ACTION_DATAWEDGE, EXTRA_SOFT_SCAN_TRIGGER, "STOP_SCANNING");
    }
    // Create filter for the broadcast intent
    private void registerReceivers() {
        Log.d(LOG_TAG, "registerReceivers()");
        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_RESULT_NOTIFICATION);   // for notification result
        filter.addAction(ACTION_RESULT);                // for error code result
        filter.addCategory(Intent.CATEGORY_DEFAULT);    // needed to get version info

        // register to received broadcasts via DataWedge scanning
        filter.addAction(getResources().getString(R.string.activity_intent_filter_action));
        filter.addAction(getResources().getString(R.string.activity_action_from_service));
        registerReceiver(myBroadcastReceiver, filter);
    }
    // Unregister scanner status notification
    public void unRegisterScannerStatus() {
        Log.d(LOG_TAG, "unRegisterScannerStatus()");
        Bundle b = new Bundle();
        b.putString(EXTRA_KEY_APPLICATION_NAME, getPackageName());
        b.putString(EXTRA_KEY_NOTIFICATION_TYPE, EXTRA_KEY_VALUE_SCANNER_STATUS);
        Intent i = new Intent();
        i.setAction(ACTION);
        i.putExtra(EXTRA_UNREGISTER_NOTIFICATION, b);
        this.sendBroadcast(i);
    }
    public String setDecoder (CheckBox decoder)
    {
        boolean checkValue = decoder.isChecked();
        String value = "false";
        if (checkValue)
        {
            value = "true";
            return value;
        }
        else
            return value;
    }
    private BroadcastReceiver myBroadcastReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            Bundle b = intent.getExtras();
            Log.d(LOG_TAG, "DataWedge Action:" + action);
            // Get DataWedge version info
            if (intent.hasExtra(EXTRA_RESULT_GET_VERSION_INFO))
            {
                Bundle versionInfo = intent.getBundleExtra(EXTRA_RESULT_GET_VERSION_INFO);
                String DWVersion = versionInfo.getString("DATAWEDGE");
                //TextView txtDWVersion = (TextView) findViewById(R.id.txtGetDWVersion);
                //txtDWVersion.setText(DWVersion);
                Log.i(LOG_TAG, "DataWedge Version: " + DWVersion);
            }
            if (action.equals(getResources().getString(R.string.activity_intent_filter_action)))
            {
                //  Received a barcode scan
                try
                {
                    displayScanResult(intent, "via Broadcast");
                }
                catch (Exception e)
                {
                    //  Catch error if the UI does not exist when we receive the broadcast...
                }
            }
            else if (action.equals(ACTION_RESULT))
            {
                // Register to receive the result code
                if ((intent.hasExtra(EXTRA_RESULT)) && (intent.hasExtra(EXTRA_COMMAND)))
                {
                    String command = intent.getStringExtra(EXTRA_COMMAND);
                    String result = intent.getStringExtra(EXTRA_RESULT);
                    String info = "";
                    if (intent.hasExtra(EXTRA_RESULT_INFO))
                    {
                        Bundle result_info = intent.getBundleExtra(EXTRA_RESULT_INFO);
                        Set<String> keys = result_info.keySet();
                        for (String key : keys) {
                            Object object = result_info.get(key);
                            if (object instanceof String) {
                                info += key + ": " + object + "\n";
                            } else if (object instanceof String[]) {
                                String[] codes = (String[]) object;
                                for (String code : codes) {
                                    info += key + ": " + code + "\n";
                                }
                            }
                        }
                        Log.d(LOG_TAG, "Command: "+command+"\n" +
                                "Result: " +result+"\n" +
                                "Result Info: " + info + "\n");
                    }
                }

            }
            // Register for scanner change notification
            else if (action.equals(ACTION_RESULT_NOTIFICATION))
            {
                if (intent.hasExtra(EXTRA_RESULT_NOTIFICATION))
                {
                    Bundle extras = intent.getBundleExtra(EXTRA_RESULT_NOTIFICATION);
                    String notificationType = extras.getString(EXTRA_RESULT_NOTIFICATION_TYPE);
                    if (notificationType != null)
                    {
                        switch (notificationType) {
                            case EXTRA_KEY_VALUE_SCANNER_STATUS:
                                // Change in scanner status occurred
                                String displayScannerStatusText = extras.getString(EXTRA_KEY_VALUE_NOTIFICATION_STATUS) +
                                        ", profile: " + extras.getString(EXTRA_KEY_VALUE_NOTIFICATION_PROFILE_NAME);
                                //final TextView lblScannerStatus = (TextView) findViewById(R.id.lblScannerStatus);
                                //lblScannerStatus.setText(displayScannerStatusText);
                                Log.i(LOG_TAG, "Scanner status: " + displayScannerStatusText);
                                break;

                            case EXTRA_KEY_VALUE_PROFILE_SWITCH:
                                // Received change in profile
                                // For future enhancement
                                break;

                            case  EXTRA_KEY_VALUE_CONFIGURATION_UPDATE:
                                // Configuration change occurred
                                // For future enhancement
                                break;
                        }
                    }
                }
            }
        }
    };
    private void displayScanResult(Intent initiatingIntent, String howDataReceived)
    {
        // store decoded data
        String decodedData = initiatingIntent.getStringExtra(getResources().getString(R.string.datawedge_intent_key_data));
        // store decoder type
        String decodedLabelType = initiatingIntent.getStringExtra(getResources().getString(R.string.datawedge_intent_key_label_type));
        Log.d(TAG, decodedData + " - " + decodedLabelType);
        dataFromAndroidToWebview(decodedData);
    }
    private void sendDataWedgeIntentWithExtra(String action, String extraKey, Bundle extras)
    {
        Intent dwIntent = new Intent();
        dwIntent.setAction(action);
        dwIntent.putExtra(extraKey, extras);
        if (bRequestSendResult)
            dwIntent.putExtra(EXTRA_SEND_RESULT, "true");
        this.sendBroadcast(dwIntent);
    }
    private void sendDataWedgeIntentWithExtra(String action, String extraKey, String extraValue)
    {
        Intent dwIntent = new Intent();
        dwIntent.setAction(action);
        dwIntent.putExtra(extraKey, extraValue);
        if (bRequestSendResult)
            dwIntent.putExtra(EXTRA_SEND_RESULT, "true");
        this.sendBroadcast(dwIntent);
    }
    public boolean isRFIDReaderConnected() {
        Log.d(TAG, "isRFIDReaderConnected: " + rfidHandler.isReaderConnected());
        return rfidHandler.isReaderConnected();
    }
    public boolean isReaderAvailable() {
        return (rfidHandler.getAvailableReaderCount() > 0 ? true : false);
    }
    private class RFIDConnectionTask extends AsyncTask<Void, Void, Void> {
        @Override
        protected Void doInBackground(Void... voids) {
            rfidHandler.InitSDK();
            return null;
        }

        @Override
        protected void onPostExecute(Void aVoid) {
            super.onPostExecute(aVoid);
        }
    }

    private void setupSound () {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            AudioAttributes audioAttributes = new AudioAttributes.Builder().setUsage(
                            AudioAttributes.USAGE_ASSISTANCE_SONIFICATION).setContentType(
                            AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
            soundPool = new SoundPool.Builder().setMaxStreams(3)
                .setAudioAttributes(audioAttributes).build();
        }
        else {
            soundPool = new SoundPool(3, AudioManager.STREAM_MUSIC,0);
        }
        // This load function takes
        // three parameter context,
        // file_name and priority.
        newTagSound = soundPool.load(this, R.raw.rfidtone, 1);
        connectSound = soundPool.load(this, R.raw.connect, 1);
        btConnectedSound = soundPool.load(this, R.raw.bluetooth_connected, 1);
        btDisconnectedSound = soundPool.load(this, R.raw.bluetooth_disconnected, 1);
        btDevFoundSound = soundPool.load(this, R.raw.dev_found_bluetooth, 1);
        btDevPairedSound = soundPool.load(this, R.raw.bluetooth_paired, 1);
    }

    public void playConnectSound () {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                soundPool.play(connectSound, 1, 1, 0, 0, 1);
            }
        }
        );
    }
    public void playBTConnectSound () {
        runOnUiThread(new Runnable() {
                          @Override
                          public void run() {
                              soundPool.play(btConnectedSound, 1, 1, 0, 0, 1);
                          }
                      }
        );
    }
    public void playBTDisconnectedSound () {
        runOnUiThread(new Runnable() {
                          @Override
                          public void run() {
                              soundPool.play(btDisconnectedSound, 1, 1, 0, 0, 1);
                          }
                      }
        );
    }
    public void playBTDevFoundSound () {
        runOnUiThread(new Runnable() {
                          @Override
                          public void run() {
                              soundPool.play(btDevFoundSound, 1, 1, 0, 0, 1);
                          }
                      }
        );
    }
    public void playBTDevPairedSound () {
        runOnUiThread(new Runnable() {
                          @Override
                          public void run() {
                              soundPool.play(btDevPairedSound, 1, 1, 0, 0, 1);
                          }
                      }
        );
    }
    /* Checks if external storage is available to at least read */
    public boolean isExternalStorageReadable() {
        String state = Environment.getExternalStorageState();
        if ( Environment.MEDIA_MOUNTED.equals( state ) ||
                Environment.MEDIA_MOUNTED_READ_ONLY.equals( state ) ) {
            return true;
        }
        return false;
    }

    /* Checks if external storage is available for read and write */
    public boolean isExternalStorageWritable() {
        String state = Environment.getExternalStorageState();
        if ( Environment.MEDIA_MOUNTED.equals( state ) ) {
            return true;
        }
        return false;
    }

    public void getReaderPower () {
        rfidHandler.getReaderPower();
    }

    public void setReaderPower (int power) {
        rfidHandler.setReaderPower(power);
    }

    final BroadcastReceiver blReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if(BluetoothDevice.ACTION_FOUND.equals(action)){
                BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                String devAddr = device.getAddress();
                String devName = device.getName();
                Log.d(TAG, "Found device : " + device.getName() + " - " + device.getAddress());
                BTDevice btdev = new BTDevice(devName, devAddr, device, BTDEVSTATUS.DISCOVERED);
                btDevMan.addDevice(devAddr, btdev);
                playBTDevFoundSound();
            }
        }
    };

    public void foundBTDevice(BluetoothDevice device) {
        String devAddr = device.getAddress();
        String devName = device.getName();
        if (devName != null && devName.indexOf(RFD8500_PREFIX) == 0) {
            Gson gson = new Gson();
            Log.d(TAG, "Found device : " + device.getName() + " - " + device.getAddress());
            if (!btDevMan.doesDeviceExist(devAddr)) {
                BTDevice btdev = new BTDevice(devName, devAddr, device, BTDEVSTATUS.DISCOVERED);
                btDevMan.addDevice(devAddr, btdev);
                String json = gson.toJson(btdev);
                playBTDevFoundSound();
                sendBluetoothData(BTMessageTypes.FOUND.toString(), json);
            }
            
        }
    }

    public void unpairDevice (String addr) {
        btDevMan.unpairRFD8500(addr);
    }

    public void bondedWithSuccess (BluetoothDevice device) {
        String devAddr = device.getAddress();
        String devName = device.getName();
        Log.d(TAG, "Bonded Successfully : " + device.getName() + " - " + device.getAddress());
        BTDevice btdev = new BTDevice(devName, devAddr, device, BTDEVSTATUS.PAIRED);
        btDevMan.addDevice(devAddr, btdev);
        //btDevMan.cleanAllUnpairedDevices();
        Gson gson = new Gson();
        String json = gson.toJson(btdev);
        playBTDevPairedSound();
        sendBluetoothData(BTMessageTypes.PAIRED_SUCCESS.toString(), json);
        bondingInProgress = false;
        new Thread (new Runnable () {
            @Override
            public void run () {
                // as soon as device is bonded, connect the TC51 to the scanner
                try {
                    new RFIDConnectionTask().execute();
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }).start();
    }

    public void unpairedWithSuccess (BluetoothDevice device) {
        String devAddr = device.getAddress();
        String devName = device.getName();
        btDevMan.removeDevice(devAddr);
        Log.d(TAG, "Bonding removed : " + device.getName() + " - " + device.getAddress());
        bondingInProgress = false;
    }

    public void deviceBondingInProgress (BluetoothDevice device) {
        bondingInProgress = true;
    }

    public void setupBluetooth () {
        if (isBluetoothON()) {
            listPairedBTDevices();
            if (mPairedDevices.size() > 0) {
                try {
                    new RFIDConnectionTask().execute();
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        }
    }

    public void turnONBluetooth () {
        if (!mBTAdapter.isEnabled()) {
            Intent enableBtIntent = new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE);
            Toast.makeText(getApplicationContext(),"Bluetooth turned on",Toast.LENGTH_SHORT).show();
            startActivityForResult(enableBtIntent, REQUEST_ENABLE_BT);
        } else {
            Log.d (TAG, "Bluetooth is already on");
        }
    }

    public void turnOFFBluetooth () {
        mBTAdapter.disable(); // turn off
        Toast.makeText(getApplicationContext(),"Bluetooth turned Off", Toast.LENGTH_SHORT).show();
    }

    public boolean isBluetoothON () {
        return mBTAdapter.isEnabled();
    }

    public void discoverBTDevices () {
        if(mBTAdapter.isDiscovering()){
            mBTAdapter.cancelDiscovery();
            Toast.makeText(getApplicationContext(),"Discovery stopped",Toast.LENGTH_SHORT).show();
        } else {
            if(mBTAdapter.isEnabled()) {
                btDevMan.cleanAllUnpairedDevices();
                mBTAdapter.startDiscovery();
                Toast.makeText(getApplicationContext(), "Discovery started", Toast.LENGTH_SHORT).show();
            } else{
                Toast.makeText(getApplicationContext(), "Bluetooth not on", Toast.LENGTH_SHORT).show();
            }
        }
    }
    private void turnOFFDiscovery () {
        if(mBTAdapter.isDiscovering()){
            mBTAdapter.cancelDiscovery();
        }
    }
    public void discoveryOfBTEnded () {
        String msg = "Bluetooth discovery ended";
        sendBluetoothData(BTMessageTypes.DISCOVERY_ENDED.toString(), msg);
    }
    public void discoveryOfBTStarted () {
        String msg = "Bluetooth discovery started";
        sendBluetoothData(BTMessageTypes.DISCOVERY_STARTED.toString(), msg);
    }

    public void listPairedBTDevices () {
        mPairedDevices = mBTAdapter.getBondedDevices();
        List<BTDevice> pairedDevs = new ArrayList<>();
        if(mBTAdapter.isEnabled()) {
            for (BluetoothDevice device : mPairedDevices) {
                String devAddr = device.getAddress();
                String devName = device.getName();
                Log.d(TAG, "List device : " + device.getName() + " - " + device.getAddress());
                if (devName != null && devName.indexOf(RFD8500_PREFIX) == 0) {
                    BTDevice btdev = new BTDevice(devName, devAddr, device, BTDEVSTATUS.PAIRED);
                    btDevMan.addDevice(devAddr, btdev);
                    pairedDevs.add(btdev);
                }
            }
        } 
        Gson gson = new Gson();
        String json = gson.toJson(pairedDevs);
        sendBluetoothData(BTMessageTypes.PAIRED.toString(), json);
    }
    public void bondWithDevice (String addr) {
        if (!bondingInProgress) {
            turnOFFDiscovery();
            disconnectRFIDScanner();
            btDevMan.unpairAllRFD8500();
            btDevMan.pairDevice(addr);
        }
    }

    private class BTDeviceManager {

        HashMap<String, BTDevice> deviceMap = new HashMap<>();
        public BTDeviceManager () {
        }
        public boolean doesDeviceExist (String addr) {
            return deviceMap.containsKey(addr);
        }
        public void addDevice (String addr, BTDevice dev) {
            deviceMap.put(addr, dev);
            // everytime a device gets added
            // we push the information to the front end
        }
        public void removeDevice (String addr) {
            deviceMap.remove(addr);
        }
        public Map<String, String> getAllDevices () {
            HashMap<String, String> devList = new HashMap<>();
            for (Map.Entry<String, BTDevice> entry : deviceMap.entrySet()) {
                String key = entry.getValue().deviceAddr;
                String value = entry.getValue().deviceName;
                devList.put(key, value);
            }
            return devList;
        }
        public void pairDevice (String addr) {
            if (deviceMap.containsKey(addr)) {
                BTDevice device = deviceMap.get(addr);
                device.pairDevice();
            }
        }
        public void unpairAllRFD8500 () {
            for (Map.Entry<String, BTDevice> entry : deviceMap.entrySet() ) {
                BTDevice btDev = entry.getValue();
                removeBondedDevices(btDev.getBluetoothDevice());
            }
        }
        public void unpairRFD8500 (String addr) {
            if (deviceMap.containsKey(addr)) {
                BTDevice btDevice = deviceMap.get(addr);
                removeBondedDevices(btDevice.getBluetoothDevice());
            }
        }
        private void removeBondedDevices (BluetoothDevice device) {
            try {
                Method m = device.getClass().getMethod("removeBond", (Class [])null);
                m.invoke(device, (Object[])null);
            } catch (NoSuchMethodException e) {
                e.printStackTrace();
            } catch (IllegalAccessException e) {
                e.printStackTrace();
            } catch (InvocationTargetException e) {
                e.printStackTrace();
            }
        }

        public synchronized void cleanAllUnpairedDevices () {
            Iterator it = deviceMap.entrySet().iterator();
            while (it.hasNext())
            {
                Map.Entry<String, BTDevice> entry = (Map.Entry<String, BTDevice>) it.next();
                BTDevice btDev = entry.getValue();
                if (btDev.pairingStatus == BTDEVSTATUS.DISCOVERED ) {
                    it.remove();
                }
            }
        }
    }
    private class BTDevice {
        private String deviceName;
        private String deviceAddr;
        private BluetoothDevice dev;
        private BTDEVSTATUS pairingStatus;
        public BTDevice () {
            deviceAddr = "";
            deviceName = "";
            pairingStatus = BTDEVSTATUS.UNKNOWN;
        }
        public BTDevice (String name, String addr, BluetoothDevice device, BTDEVSTATUS sts) {
            deviceName = name;
            deviceAddr = addr;
            dev = device;
            pairingStatus = sts;
        }
        public void pairDevice () {
            dev.createBond();
        }
        public void connectToDevice () {
        }
        public BluetoothDevice getBluetoothDevice () {
            return dev;
        }
    }

    public class ReadIniFileAsyncTask extends AsyncTask<String, Void, KmartDeviceInfo> {

        /**
         * @param strings
         * @deprecated
         */
        @Override
        protected KmartDeviceInfo doInBackground(String... strings) {
            String location = strings[0];
            KmartDeviceInfo deviceInfo = new KmartDeviceInfo();
            try {
                Wini ini = new Wini(new File(CUSTOMDATA_INI_FILE));
                String storeNumber = ini.get("StoreNumber", "Number");
                String geoState = ini.get("GeoState", "State");
                String applicationServer = ini.get("ApplicationServer", "Name");
                String deviceName = ini.get("DeviceName", "Name");
                deviceInfo.setStoreNumber(storeNumber);
                deviceInfo.setGeoState(geoState);
                deviceInfo.setAppServer(applicationServer);
                deviceInfo.setDeviceName(deviceName);
                Log.d(TAG, "INI: StoreNumber " + storeNumber);
                Log.d(TAG, "INI: GeoState " + geoState);
                Log.d(TAG, "INI: ApplicationServer " + applicationServer);
                Log.d(TAG, "INI: DeviceName " + deviceName);
                Log.d(TAG, "INI: Version " + deviceInfo.getVersion());
            } catch (IOException e) {
                e.printStackTrace();
            }
            return deviceInfo;
        }

        @Override
        protected void onPostExecute(KmartDeviceInfo result) {
            kmartDeviceInfo = result;
            Log.d(TAG, "calling API for Store: " + result.getStoreNumber());
            if(!result.getStoreNumber().equals("")) {
                parseResponse(result.getStoreNumber());
            } else {
                loadURLWebView(BuildConfig.DEFAULT_URL, false);
            }
        }
    }

    public void getStoreSettings(Integer store_id, boolean isUpdate) {
        if (store_id != null) {
            Call<StoreSettings> call = apiInterface.fetchAllData(store_id);
            call.enqueue(new Callback<StoreSettings>() {
                @Override
                public void onResponse(Call<StoreSettings> call, Response<StoreSettings> response) {
                    parseResponse(response.body(), isUpdate);
                }
                @Override
                public void onFailure(Call<StoreSettings> call, Throwable t) {
                    Log.d(TAG, "An error occured " + t.getLocalizedMessage());
                    parseResponse(null, false & isUpdate);
                }
            });
        } else {
            loadURLWebView(null, false);
        }
    }

    private void parseResponse(String storeNumber) {
        String loadURL = BuildConfig.DEFAULT_URL;
        try {
            if(storeNumber.matches(BuildConfig.devPattern)) {
                Log.d(TAG, storeNumber+"-STR is a DEV store");
                loadURL = BuildConfig.DEV_URL;
            } else if(storeNumber.matches(BuildConfig.uatPattern)) {
                Log.d(TAG, storeNumber+"-STR is a UAT store");
                loadURL = BuildConfig.UAT_URL;
            } else {
                Log.d(TAG, storeNumber+"-STR is a PROD store");
                loadURL = BuildConfig.DEFAULT_URL;
            }
            loadURLWebView(loadURL, false);
        } catch (Exception e) {
            Log.d(TAG, e.getLocalizedMessage());
        }
    }

    private void parseResponse(StoreSettings responsebody, boolean isUpdate) {
        try {
            if (responsebody != null) {
                List<Store> storeSettings = responsebody.getResponse();
                Store store = storeSettings.get(0);
                if(store.getIsDev() == 1) {
                    Log.d(TAG, "Loading DEV_URL");
                    Log.d(TAG, "Should be loading " + store.getEnvURL());
                    String loadURL = (store.getEnvURL() != null) ? store.getEnvURL() : BuildConfig.DEV_URL;
                    loadURLWebView(loadURL, false);
                } else if (store.getIsUAT() == 1) {
                    Log.d(TAG, "Loading UAT_URL");
                    Log.d(TAG, "Should be loading " + store.getEnvURL());
                    String loadURL = (store.getEnvURL() != null) ? store.getEnvURL() : BuildConfig.UAT_URL;
                    loadURLWebView(loadURL, false);
                } else {
                    Log.d(TAG, "Loading DEFAULT_URL/Prod");
                    loadURLWebView(BuildConfig.DEFAULT_URL, false); // prod is default
                }
            } else {
                Log.d(TAG, "responsebody is NULL. Loading DEFAULT_URL");
                loadURLWebView(null, false);
            }
        } catch (Exception e) {
            Log.d(TAG, e.getLocalizedMessage());
        }
    }

    private void loadURLWebView(String url, boolean update) {
        if(url != null) {
            if (!update) {
                currentWebviewURL = url;
                _webView.loadUrl(url);
            } else {
                if(!url.equals(currentWebviewURL)) {
                    // show popup
                    _webView.loadUrl(url);
                } 
            }
        } else {
            _webView.loadUrl(BuildConfig.DEFAULT_URL);
        }
    }
}

