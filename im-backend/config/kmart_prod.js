let kmartConfig = {
    api_host: process.env.API_HOST || "https://kmart.anko.com",
    base_url: "https://kmart.anko.com",
    aws_region: "ap-southeast-2",
    secret_name: "kmart-prod-secret",
    email_region: "ap-southeast-2",
    email_sender: "noreply@anko.com",
    enable_firehose_logs: true,
    s3_bucket: {
        wms_assets: "kmart-prod-images",
        bot_run_map: "kmart-prod-images",
        wms_assets_url: "/wms/assets/images",
        bot_run_map_url: "/wms/assets/images",
        StoreFilesWithDomain: false,
        logging: "kmart-prod-logging",
        csv_backup:"kmart-prod-csv-backup",
        reports: "kmart-prod-wms-reports",
        replenish_case_to_task: "kmart-prod-replenish-case-to-task-logs",
    },
    dynamodb: {
        inventory_log : "kmart-prod-inventory-log",
        performance_log : "kmart-prod-performance-log",
        task_log : "kmart-prod-task-log",
    },
    firehose_delivery_stream_name: "kmart-prod-logging",
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
