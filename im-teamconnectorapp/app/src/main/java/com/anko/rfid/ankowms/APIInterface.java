package com.anko.rfid.ankowms;

import retrofit2.Call;
import retrofit2.http.GET;
import retrofit2.http.Header;
import retrofit2.http.Query;

public interface APIInterface {
    // https://kmart.anko.com/api/env_settings?store_id=1154
    @GET("env_settings")
    Call<StoreSettings> fetchAllData(
            @Query("store_id") Integer store_id
    );
}
