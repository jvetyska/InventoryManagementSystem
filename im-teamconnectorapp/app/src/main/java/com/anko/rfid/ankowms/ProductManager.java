package com.anko.rfid.ankowms;

import java.util.ArrayList;

public class ProductManager {

    private ArrayList<Product> productList;
    public ProductManager() {
       productList =  new ArrayList<Product>();
    }

    public ArrayList<Product> getProductList() {
        return productList;
    }

    public void updateProductList(Product p) {

    }
}
