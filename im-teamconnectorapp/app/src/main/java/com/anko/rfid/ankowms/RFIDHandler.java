package com.anko.rfid.ankowms;


import android.content.Context;
import android.os.AsyncTask;
import android.util.Log;
import android.widget.Toast;

import com.google.gson.Gson;
import com.zebra.rfid.api3.ACCESS_OPERATION_CODE;
import com.zebra.rfid.api3.ACCESS_OPERATION_STATUS;
import com.zebra.rfid.api3.Antennas;
import com.zebra.rfid.api3.BEEPER_VOLUME;
import com.zebra.rfid.api3.ENUM_TRANSPORT;
import com.zebra.rfid.api3.ENUM_TRIGGER_MODE;
import com.zebra.rfid.api3.HANDHELD_TRIGGER_EVENT_TYPE;
import com.zebra.rfid.api3.INVENTORY_STATE;
import com.zebra.rfid.api3.InvalidUsageException;
import com.zebra.rfid.api3.OperationFailureException;
import com.zebra.rfid.api3.RFIDReader;
import com.zebra.rfid.api3.ReaderDevice;
import com.zebra.rfid.api3.Readers;
import com.zebra.rfid.api3.RfidEventsListener;
import com.zebra.rfid.api3.RfidReadEvents;
import com.zebra.rfid.api3.RfidStatusEvents;
import com.zebra.rfid.api3.SESSION;
import com.zebra.rfid.api3.SL_FLAG;
import com.zebra.rfid.api3.START_TRIGGER_TYPE;
import com.zebra.rfid.api3.STATUS_EVENT_TYPE;
import com.zebra.rfid.api3.STOP_TRIGGER_TYPE;
import com.zebra.rfid.api3.SetAttribute;
import com.zebra.rfid.api3.TagData;
import com.zebra.rfid.api3.TagDataArray;
import com.zebra.rfid.api3.TriggerInfo;

import java.util.ArrayList;
class RFIDHandler implements Readers.RFIDReaderEventHandler {
    final String TAG = "RFIDHandler";
    final String CONNECTED_RESPONSE = "true";
    final String ERR_CONN_RESPONSE = "false";
    // RFID Reader
    private static Readers readers;
    private static ArrayList<ReaderDevice> availableRFIDReaderList;
    private static ReaderDevice readerDevice;
    private static RFIDReader reader;
    private EventHandler eventHandler;
    private Context _context;
    // UI and context
    //TextView textView;
    private MainActivity _activity;
    private Context _appContext;
    // general
    private int MAX_POWER = 220;
    private boolean errorOnConnecting = false;
    private static boolean connectionError = false;
    //private int MAX_POWER = 270;
    // In case of RFD8500 change reader name with intended device below from list of paired RFD8500
    String readername = "RFD8500123";
    void onCreate(MainActivity activity) {
        _activity = activity;
        _appContext = activity.getApplicationContext();
        //InitSDK();
    }
    String onResume() {
        return connect();
    }
    void onPause() {
        disconnect();
    }
    void onDestroy() {
        dispose();
    }
    public void setTriggerModeRFID() throws InvalidUsageException, OperationFailureException {
        // set RFID mode using attribute API
        SetAttribute setAttributeInfo = new SetAttribute();
        setAttributeInfo.setAttnum(1664);
        setAttributeInfo.setAtttype("B");
        setAttributeInfo.setAttvalue("0"); // Use 1 for barcode
        reader.Config.setAttribute(setAttributeInfo);
        reader.Config.setTriggerMode(ENUM_TRIGGER_MODE.RFID_MODE, true);
    }
    public void setTriggerModeBarcode() throws InvalidUsageException, OperationFailureException {
        // set RFID mode using attribute API
        SetAttribute setAttributeInfo = new SetAttribute();
        setAttributeInfo.setAttnum(1664);
        setAttributeInfo.setAtttype("B");
        setAttributeInfo.setAttvalue("1");
        reader.Config.setAttribute(setAttributeInfo);
        reader.Config.setTriggerMode(ENUM_TRIGGER_MODE.BARCODE_MODE, true);
    }
    public void InitSDK() {
        Log.d(TAG, "InitSDK");
        try {
            if (readers == null) {
                new CreateInstanceTask().execute();
            } else {
                new ConnectionTask().execute();
            }
        } catch (Exception e) {
            throw e;
        }
    }
    public boolean isReaderConnected() {
        if (reader != null &&  (connectionError  == false) && reader.isConnected()) {
            Log.d(TAG, "reader is connected");
            return true;
        } else {
            Log.d(TAG, "reader is not connected");
            return false;
        }
    }
    public synchronized String connect() {
        String responseStr = "";
        if (reader != null) {
            Log.d(TAG, "connect " + reader.getHostName()) ;
            try {
                if (!reader.isConnected()) {
                    // Establish connection to the RFID Reader
                    reader.connect();
                    connectionError = false;
                    //return "Connected";
                    // return CONNECTED_RESPONSE;
                    responseStr = CONNECTED_RESPONSE;
                }
            } catch (InvalidUsageException e) {
                e.printStackTrace();
                errorOnConnecting = true;
                connectionError = true;
                responseStr = ERR_CONN_RESPONSE;
            } catch (OperationFailureException e) {
                errorOnConnecting = true;
                e.printStackTrace();
                Log.d(TAG, "OperationFailureException " + e.getVendorMessage());
                String des = e.getResults().toString();
                String errStr = "Connection failed" + e.getVendorMessage() + " " + des;
                connectionError = true;
                // return ERR_CONN_RESPONSE;
                responseStr = ERR_CONN_RESPONSE;
            } finally {
                if (isReaderConnected()) {
                    ConfigureReader();
                }
            }
            
        }
        return responseStr;
    }
    public synchronized void disconnect() {
        Log.d(TAG, "disconnect " + reader);
        try {
            if (reader != null) {
                reader.Events.removeEventsListener(eventHandler);
                reader.disconnect();
            }
        } catch (InvalidUsageException e) {
            e.printStackTrace();
        } catch (OperationFailureException e) {
            e.printStackTrace();
        } catch (Exception e) {
            e.printStackTrace();
        }
        if (!errorOnConnecting) {
            _activity.playConnectSound();
        }
    }
    private synchronized void dispose() {
        try {
            if (readers != null) {
                reader = null;
                readers.Dispose();
                readers = null;
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
    // Enumerates SDK based on host device
    private class CreateInstanceTask extends AsyncTask<Void, Void, Void> {
        @Override
        protected Void doInBackground(Void... voids) {
            Log.d(TAG, "CreateInstanceTask");
            // Based on support available on host device choose the reader type
            InvalidUsageException invalidUsageException = null;
            try {
                readers = new Readers(_activity, ENUM_TRANSPORT.SERVICE_SERIAL);
                availableRFIDReaderList = readers.GetAvailableRFIDReaderList();
            } catch (InvalidUsageException e) {
                e.printStackTrace();
                invalidUsageException = e;
            }
            if (invalidUsageException != null) {
                readers.Dispose();
                readers = null;
                if (readers == null) {
                    readers = new Readers(_activity, ENUM_TRANSPORT.BLUETOOTH);
                }
            }
            return null;
        }
        @Override
        protected void onPostExecute(Void aVoid) {
            super.onPostExecute(aVoid);
            new ConnectionTask().execute();
        }
    }
    private class ConnectionTask extends AsyncTask<Void, Void, String> {
        @Override
        protected String doInBackground(Void... voids) {
            Log.d(TAG, "ConnectionTask");
            GetAvailableReader();
            if (reader != null)
                return connect();
            return "Failed to find or connect reader";
        }
        @Override
        protected void onPostExecute(String result) {
            super.onPostExecute(result);
            _activity.errorFromAndroidToWebview(result);
            Log.d(TAG, "Result: " + result);
            if (!errorOnConnecting) {
                try {
                    _activity.updateConnectedToReaderVar(reader.getHostName());
                    _activity.playConnectSound();
                } catch (Exception e) {
                   e.printStackTrace();
                }

            }
        }
    }
    private synchronized void GetAvailableReader() {
        Log.d(TAG, "GetAvailableReader");
        try {
            if (readers != null) {
                readers.attach(this);
                if (readers.GetAvailableRFIDReaderList() != null) {
                    availableRFIDReaderList = readers.GetAvailableRFIDReaderList();
                    if (availableRFIDReaderList.size() != 0) {
                        // if single reader is available then connect it
                        if (availableRFIDReaderList.size() == 1) {
                            readerDevice = availableRFIDReaderList.get(0);
                            reader = readerDevice.getRFIDReader();
                        } else {
                            // search reader specified by name
                            for (ReaderDevice device : availableRFIDReaderList) {
                                if (device.getName().equals(readername)) {
                                    readerDevice = device;
                                    reader = readerDevice.getRFIDReader();
                                }
                            }
                        }
                    }
                }
            }
        } catch (InvalidUsageException e) {
            e.printStackTrace();
        }
    }
    private void ConfigureReader() {
        Log.d(TAG, "ConfigureReader " + reader.getHostName());
        if (reader.isConnected()) {
            TriggerInfo triggerInfo = new TriggerInfo();
            triggerInfo.StartTrigger.setTriggerType(START_TRIGGER_TYPE.START_TRIGGER_TYPE_IMMEDIATE);
            triggerInfo.StopTrigger.setTriggerType(STOP_TRIGGER_TYPE.STOP_TRIGGER_TYPE_IMMEDIATE);

            try {
                BEEPER_VOLUME beeperVolume = reader.Config.getBeeperVolume();
                reader.Config.setBeeperVolume(BEEPER_VOLUME.QUIET_BEEP);
                // receive events from reader
                if (eventHandler == null)
                    eventHandler = new EventHandler();
                reader.Events.addEventsListener(eventHandler);
                // HH event
                reader.Events.setHandheldEvent(true);
                // tag event with tag data
                reader.Events.setTagReadEvent(true);
                reader.Events.setAttachTagDataWithReadEvent(false);
                reader.Events.setReaderDisconnectEvent(true);
                // set trigger mode as rfid so scanner beam will not come
                reader.Config.setTriggerMode(ENUM_TRIGGER_MODE.RFID_MODE, false);
                // set start and stop triggers
                reader.Config.setStartTrigger(triggerInfo.StartTrigger);
                reader.Config.setStopTrigger(triggerInfo.StopTrigger);
                // power levels are index based so maximum power supported get the last one
                MAX_POWER = reader.ReaderCapabilities.getTransmitPowerLevelValues().length - 1;
                // set antenna configurations
                Antennas.AntennaRfConfig config = reader.Config.Antennas.getAntennaRfConfig(1);
                config.setTransmitPowerIndex(MAX_POWER-100);
                config.setrfModeTableIndex(0);
                config.setTari(0);
                reader.Config.Antennas.setAntennaRfConfig(1, config);
                // Set the singulation control
                // Antennas.SingulationControl s1_singulationControl = reader.Config.Antennas.getSingulationControl(1);
                // s1_singulationControl.setSession(SESSION.SESSION_S0);
                // s1_singulationControl.Action.setInventoryState(INVENTORY_STATE.INVENTORY_STATE_A);
                // s1_singulationControl.Action.setSLFlag(SL_FLAG.SL_ALL);
                // reader.Config.Antennas.setSingulationControl(1, s1_singulationControl);
                setSingulation(SESSION.SESSION_S1, INVENTORY_STATE.INVENTORY_STATE_A);
                // delete any prefilters
                reader.Actions.PreFilters.deleteAll();
                //
            } catch (InvalidUsageException | OperationFailureException e) {
                e.printStackTrace();
                errorOnConnecting = true;
                connectionError = true;
            }
        }
    }

    private void reConfigureReader(int power) {
        Log.d(TAG, "ConfigureReader " + reader.getHostName());
        if (reader.isConnected()) {
            TriggerInfo triggerInfo = new TriggerInfo();
            triggerInfo.StartTrigger.setTriggerType(START_TRIGGER_TYPE.START_TRIGGER_TYPE_IMMEDIATE);
            triggerInfo.StopTrigger.setTriggerType(STOP_TRIGGER_TYPE.STOP_TRIGGER_TYPE_IMMEDIATE);

            try {
                BEEPER_VOLUME beeperVolume = reader.Config.getBeeperVolume();
                reader.Config.setBeeperVolume(BEEPER_VOLUME.QUIET_BEEP);
                if (eventHandler == null)
                    eventHandler = new EventHandler();
                reader.Events.addEventsListener(eventHandler);
                reader.Events.setHandheldEvent(true);
                reader.Events.setTagReadEvent(true);
                reader.Events.setAttachTagDataWithReadEvent(false);
                reader.Events.setReaderDisconnectEvent(true);
                reader.Config.setTriggerMode(ENUM_TRIGGER_MODE.RFID_MODE, false);
                reader.Config.setStartTrigger(triggerInfo.StartTrigger);
                reader.Config.setStopTrigger(triggerInfo.StopTrigger);
                MAX_POWER = reader.ReaderCapabilities.getTransmitPowerLevelValues().length - 1;
                Antennas.AntennaRfConfig config = reader.Config.Antennas.getAntennaRfConfig(1);
                int oldRFValue = config.getTransmitPowerIndex();
                if (power > MAX_POWER) {
                    power = oldRFValue;
                }
                config.setTransmitPowerIndex(power);
                config.setrfModeTableIndex(0);
                config.setTari(0);
                reader.Config.Antennas.setAntennaRfConfig(1, config);
                setSingulation(SESSION.SESSION_S1, INVENTORY_STATE.INVENTORY_STATE_A);
                reader.Actions.PreFilters.deleteAll();
                int finalPower = power;
                _activity.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        String msg = "Power set to: " + finalPower;
                        if (finalPower <= 120) {
                            msg = "Using Low power settings";
                        } else if (finalPower <= 160) {
                            msg = "Using Medium power settings";
                        } else if (finalPower <= 240) {
                            msg = "Using High power settings";
                        }
                        Toast.makeText(_activity.getApplicationContext(), msg, Toast.LENGTH_SHORT).show();
                    }
                });
            } catch (InvalidUsageException | OperationFailureException e) {
                e.printStackTrace();
            }
        }
    }

    @Override
    public void RFIDReaderAppeared(ReaderDevice readerDevice) {
        Log.d(TAG, "RFIDReaderAppeared " + readerDevice.getName());
    }

    @Override
    public void RFIDReaderDisappeared(ReaderDevice readerDevice) {
        Log.d(TAG, "RFIDReaderDisappeared " + readerDevice.getName());
            try {
                if(reader != null) {
                    reader.disconnect();
                }
            } catch (InvalidUsageException e) {
                e.printStackTrace();
            } catch (OperationFailureException e) {
                e.printStackTrace();
            }
    }

    // Read/Status Notify handler
    // Implement the RfidEventsLister class to receive event notifications
    public class EventHandler implements RfidEventsListener {
        // Read Event Notification
        public void eventReadNotify(RfidReadEvents e) {
            // Recommended to use new method getReadTagsEx for better performance in case of large tag population
            //TagData[] myTags = reader.Actions.getReadTags(100);
            TagDataArray myLargeTags = reader.Actions.getReadTagsEx(1000);
            TagData[] myTags = myLargeTags.getTags();
            if (myTags != null) {
                /***
                for (int index = 0; index < myTags.length; index++) {
                    Log.d(TAG, "Tag ID " + myTags[index].getTagID());
                    if (myTags[index].getOpCode() == ACCESS_OPERATION_CODE.ACCESS_OPERATION_READ &&
                            myTags[index].getOpStatus() == ACCESS_OPERATION_STATUS.ACCESS_SUCCESS) {
                        if (myTags[index].getMemoryBankData().length() > 0) {
                            Log.d(TAG, " Mem Bank Data " + myTags[index].getMemoryBankData());
                        }
                    }
                    if (myTags[index].isContainsLocationInfo()) {
                        short dist = myTags[index].LocationInfo.getRelativeDistance();
                        Log.d(TAG, "Tag relative distance " + dist);
                    }
                }
                 ***/
                // possibly if operation was invoked from async task and still busy
                // handle tag data responses on parallel thread thus THREAD_POOL_EXECUTOR
                new AsyncDataUpdate().executeOnExecutor(AsyncTask.THREAD_POOL_EXECUTOR, myTags);
            }
        }

        // Status Event Notification
        public void eventStatusNotify(RfidStatusEvents rfidStatusEvents) {
            Log.d(TAG, "Status Notification: " + rfidStatusEvents.StatusEventData.getStatusEventType());
            if (rfidStatusEvents.StatusEventData.getStatusEventType() == STATUS_EVENT_TYPE.HANDHELD_TRIGGER_EVENT) {
                if (rfidStatusEvents.StatusEventData.HandheldTriggerEventData.getHandheldEvent() == HANDHELD_TRIGGER_EVENT_TYPE.HANDHELD_TRIGGER_PRESSED) {
                    new AsyncTask<Void, Void, Void>() {
                        @Override
                        protected Void doInBackground(Void... voids) {
                            _activity.handleTriggerPress(true);
                            return null;
                        }
                    }.execute();
                }
                if (rfidStatusEvents.StatusEventData.HandheldTriggerEventData.getHandheldEvent() == HANDHELD_TRIGGER_EVENT_TYPE.HANDHELD_TRIGGER_RELEASED) {
                    new AsyncTask<Void, Void, Void>() {
                        @Override
                        protected Void doInBackground(Void... voids) {
                            _activity.handleTriggerPress(false);
                            return null;
                        }
                    }.execute();
                }
            }
            if(rfidStatusEvents.StatusEventData.getStatusEventType() == STATUS_EVENT_TYPE.DISCONNECTION_EVENT) {
                connectionError = true;
            }
        }
    }

    private class AsyncDataUpdate extends AsyncTask<TagData[], Void, Void> {
        @Override
        protected Void doInBackground(TagData[]... params) {
            _activity.handleTagdata(params[0]);
            return null;
        }
    }

    synchronized void performInventory() {
        // check reader connection
        if (!isReaderConnected())
            return;
        try {
            reader.Actions.Inventory.perform();
        } catch (InvalidUsageException e) {
            e.printStackTrace();
        } catch (OperationFailureException e) {
            e.printStackTrace();
        }
    }

    synchronized void stopInventory() {
        // check reader connection
        if (!isReaderConnected())
            return;
        try {
            reader.Actions.Inventory.stop();
        } catch (InvalidUsageException e) {
            e.printStackTrace();
        } catch (OperationFailureException e) {
            e.printStackTrace();
        }
    }

    public int getAvailableReaderCount() {
        return availableRFIDReaderList.size();
    }

    public void forceGetAvailableReader() {
        GetAvailableReader();
    }

    private void setAntennaPower(int power) {
        Log.d(TAG, "setAntennaPower " + power);
        try {
            // set antenna configurations
            Antennas.AntennaRfConfig config = reader.Config.Antennas.getAntennaRfConfig(1);
            config.setTransmitPowerIndex(power);
            config.setrfModeTableIndex(0);
            config.setTari(0);
            reader.Config.Antennas.setAntennaRfConfig(1, config);
        } catch (InvalidUsageException e) {
            e.printStackTrace();
        } catch (OperationFailureException e) {
            e.printStackTrace();
        }
    }

    private void setSingulation(SESSION session, INVENTORY_STATE state) {
        Log.d(TAG, "setSingulation " + session);
        try {
            if (!connectionErrStatus()) {
                // Set the singulation control
                Antennas.SingulationControl singulationControl = reader.Config.Antennas.getSingulationControl(1);
                singulationControl.setSession(session);
                singulationControl.Action.setInventoryState(state);
                singulationControl.setTagPopulation((short) 32767);
                singulationControl.Action.setSLFlag(SL_FLAG.SL_ALL);
                singulationControl.Action.setPerformStateAwareSingulationAction(true);
                reader.Config.Antennas.setSingulationControl(1, singulationControl);
            }
           
        } catch (InvalidUsageException e) {
            e.printStackTrace();
        } catch (OperationFailureException e) {
            e.printStackTrace();
        }
    }
    public void getReaderPower () {
        AsyncTask.execute(() -> {
                    try {
                        if (!connectionErrStatus()) {
                            Antennas.AntennaRfConfig config = reader.Config.Antennas.getAntennaRfConfig(1);
                            int rfValue = config.getTransmitPowerIndex();
                            String str = "" + rfValue;
                            // double percent = Math.ceil ((rfValue/MAX_POWER) * 100);
                            // Gson gson = new Gson();
                            // String json = gson.toJson(config);
                            _activity.sendAntennaConfig(str);
                        }
                        
                    } catch (InvalidUsageException e) {
                        e.printStackTrace();
                    } catch (OperationFailureException e) {
                        e.printStackTrace();
                    }
                }

        );

    }
    public void setReaderPower (int power) {
        AsyncTask.execute(() -> {
            try {
                reConfigureReader(power);
            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }
    public boolean connectionErrStatus () {
        return errorOnConnecting;
    }
}

