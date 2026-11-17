let localConfig = {
    api_host: process.env.API_HOST,
    enable_firehose_logs: false,
    aws_endpoint: process.env.AWS_ENDPOINT,
    aws_region: "ap-southeast-2",
    secret_name: "dev-secret",
    email_region: "ap-southeast-2",
    email_sender: "noreply@anko.com",
    sql_host: process.env.DB_HOST,
    s3_bucket: {
        wms_assets: 'dev-images',
        bot_run_map: 'dev-images',
        wms_assets_url: 'https://kmart-dev.anko.com/wms/assets/images',
        bot_run_map_url: 'https://kmart-dev.anko.com/wms/assets/images',
        logging: 'dev-logging',
        csv_backup: 'dev-csv-backup',
        reports: 'dev-wms-reports',
        replenish_case_to_task: 'dev-replenish-case-to-task-logs'
    },
    dynamodb: {
        inventory_log: 'dev-inventory-log',
        performance_log: 'dev-performance-log',
        task_log: 'dev-task-log'
    },
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
}

module.exports = localConfig