let kmartConfig = {
    api_host: process.env.API_HOST || "https://app.nonprod.dosasvt.a-kmtkmg.net",
    base_url: "https://app.nonprod.dosasvt.a-kmtkmg.net",
    aws_region: "ap-southeast-2",
    secret_name: "kmart-svt-secret",
    email_region: "ap-southeast-2",
    email_sender: "noreply@kmtdosa.com",
    email_arn: "arn:aws:ses:ap-southeast-2:350227333798:identity/kmtdosa.com",
    enable_firehose_logs: true,
    dynamodb: {
        inventory_log : "svt-ap-southeast-2-dosa-inventory-log",
        performance_log : "svt-ap-southeast-2-dosa-performance-log",
        task_log : "svt-ap-southeast-2-kmart-dosa-task-log",
    },
    firehose_delivery_stream_name: "dosa-svt-logging",
    tory_api: "tory/api/",
    store_api: "store/api/",
    integration_service: "integration/service/",
    mysql: {
        db_connection_limit: 100,
        db_queue_limit: 20,
        db_debug: false,
        db_ro_connection_limit: 100,
        db_ro_queue_limit: 20,
        db_ro_debug: false
    },
    is_cluster_enabled: true,
    cluster_cores: 4
};

kmartConfig.s3_bucket = {
    wms_assets: "kmart-dosa-svt-images",
    bot_run_map: "kmart-dosa-svt-images",
    wms_assets_url: `/wms/assets/images`,
    bot_run_map_url: `/wms/assets/images`,
    StoreFilesWithDomain: false,
    logging: "kmart-dosa-svt-logging",
    csv_backup:"kmart-dosa-svt-csv-backup",
    reports: "kmart-dosa-svt-wms-reports",
    replenish_case_to_task: "kmart-dosa-svt-case-to-task-logs",
};

module.exports = kmartConfig;
