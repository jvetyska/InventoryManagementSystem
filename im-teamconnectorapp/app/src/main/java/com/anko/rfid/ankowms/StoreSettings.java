package com.anko.rfid.ankowms;

import java.util.List;

public class StoreSettings {
    private List<Store> response;
    public StoreSettings (List<Store> response) {
        this.response = response;
    }
    public List<Store> getResponse() { return response; }
    public void setResponse(List<Store> response) { this.response = response; }
}
