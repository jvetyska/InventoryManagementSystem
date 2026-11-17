let devConfig = {
    api_host: process.env.API_HOST || "https://api-dev.anko.com",
    default_aws_region: "us-east-2",
    aws_region: "us-east-2",
    email_region: "us-west-2",
    email_sender: "noreply@anko.com",
    secret_name: "AnkoMicroserviceSecrets",
    enable_firehose_logs: true,
    s3_bucket: {
        wms_assets: "bot-location-map",
        bot_run_map: "bot-run-map",
        wms_assets_url: "https://bot-location-map.s3.amazonaws.com",
        bot_run_map_url: "https://bot-run-map.s3.amazonaws.com",
        StoreFilesWithDomain: false,
        logging: "anko-whm-logging",
        csv_backup:"anko-csv-backup",
        reports: "wms-reports",
        replenish_case_to_task: "replenish-case-to-task-logs",
    },
    dynamodb: {
        inventory_log : "inventory_log_dev",
        performance_log : "performance_log_dev",
        task_log : "task_log_dev",
    },
    firehose_delivery_stream_name: "dev-anko-whm-logging",
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

module.exports = devConfig;
