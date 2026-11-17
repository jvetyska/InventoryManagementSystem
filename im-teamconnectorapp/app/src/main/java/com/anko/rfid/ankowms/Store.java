package com.anko.rfid.ankowms;

public class Store {

    public  Store(String locationID, int isUAT, int isDEV, String EnvURL) {
        this.LocationID = locationID;
        this.isUAT = isUAT;
        this.isDEV = isDEV;
        this.EnvURL = EnvURL;
    }
    private String LocationID;
    private int isUAT;
    private int isDEV;
    private String EnvURL;
    public String getLocationID() { return LocationID; }
    public void setLocationID(String id) { LocationID = id; }
    public int getIsUAT() { return isUAT; }
    public void setIsUAT (int val) { isUAT = val; }
    public int getIsDev() { return isDEV; }
    public void setIsDev(int val) { isDEV = val; }
    public String getEnvURL() { return EnvURL; }
    public void setEnvURL(String val) { EnvURL = val; }
}
