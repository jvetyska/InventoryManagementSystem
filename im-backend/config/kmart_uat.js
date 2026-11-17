let kmartConfig = {
    api_host: process.env.API_HOST || "https://kmart-uat.anko.com",
    base_url: "https://kmart-uat.anko.com",
    aws_region: "ap-southeast-2",
    secret_name: "kmart-uat-secret",
    email_region: "ap-southeast-2",
    email_sender: "noreply@anko.com",
    enable_firehose_logs: true,
    s3_bucket: {
        wms_assets: "kmart-uat-images",
        bot_run_map: "kmart-uat-images",
        wms_assets_url: "/wms/assets/images",
        bot_run_map_url: "/wms/assets/images",
        StoreFilesWithDomain: false,
        logging: "kmart-uat-logging",
        csv_backup:"kmart-uat-csv-backup",
        reports: "kmart-uat-wms-reports",
        replenish_case_to_task: "kmart-uat-replenish-case-to-task-logs",
    },
    dynamodb: {
        inventory_log : "kmart-uat-inventory-log",
        performance_log : "kmart-uat-performance-log",
        task_log : "kmart-uat-task-log",
    },
    firehose_delivery_stream_name: "kmart-uat-logging",
    tory_api: "tory/api/",
    store_api: "store/api/",
    integration_service: "integration/service/",
    mysql: {
        db_connection_limit: 50,
        db_queue_limit: 20,
        db_debug: false,
        db_ro_connection_limit: 50,
        db_ro_queue_limit: 20,
        db_ro_debug: false
    },
    is_cluster_enabled: true,
    cluster_cores: 2
};

module.exports = kmartConfig;
