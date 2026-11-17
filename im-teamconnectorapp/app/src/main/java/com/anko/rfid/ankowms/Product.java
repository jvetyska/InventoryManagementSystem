package com.anko.rfid.ankowms;

import java.util.ArrayList;

public class Product {
    private String barcode;
    private ArrayList<String> epcList;
    private int quantity;
    public Product() {
        epcList = new ArrayList<String>();
        quantity = 0;
    }
    public Product(String _barcode, String epc) {
        epcList = new ArrayList<String>();
        quantity = 0;
        barcode = _barcode;
        setEpcList(epc);
    }
    public void setBarcode(String barcode) {
        this.barcode = barcode;
    }
    public String getBarcode() {
        return barcode;
    }
    public synchronized void setEpcList(String epc) {
        epcList.add(epc);
        calcQuantity();
    }
    public ArrayList<String> getEpcList() {
        return epcList;
    }
    public int getQuantity() {
        calcQuantity();
        return quantity;
    }

    private void calcQuantity() {
        quantity =  epcList.size();
    }

}
