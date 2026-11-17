//********** SYSTEM SETTINGS **********
// Business Logic constants, etc.
// Access server variables via: process.env.VARIABLE

const settings = {
    validation: {
        maxQuantity: 350,
        maxQtyOverrideList: ["42709664"], // Reuse Bag
        maxQtyOverride: 500
    },
    task: {
        groupSizePick: 100,       // Size of task_group of type = 'Pick'
        groupSizeInventory: 100,  // Size of task_group of Type = 'Inventory'
        groupSizeBackfill: 100,   // Size of task_group of Type = 'Backfill'
        groupSizeThreshold: 5,    // If the next group would be less then the Threshold, include all in this group
        groupSizeOnline: 4        // Number of Online Orders (sale_transaction.ID) to group together
    },
    replenish: {
        factor_OOS: 1,            // Out Of Stock boost factor
    },
    dueDate: {
        offsetDefault: 4,         // Default Due Date + hours
        offsetPickStandard: 1.1,  // 70 minutes for standard Pick
        offsetPickFasttrack: 0.8, // 50 minutes for FastTrack Pick
        offsetOnlineShip: 1.9,    // 2 hours for Online Order shipped to customer
        offsetOnlineISP: 0.8,     // 50 minutes for Online Order -> In Store Pickup
        offsetInventory: 4,       // 4 hours for Inventory tasks that have no Truck schedule
        offsetCasePick: 4,        // 4 hours for Replenishment picks for FIF1-WRH
        offsetBackfill: 0.8       // 50 minutes for Backfill Pick
    },
    receiveToStow: {
        maxLocationPerSKU: 10,     // The max number of shelves that a Keycode can be stowed at Unit Level warehouse
        maxLocationPerCase: 10     // The max number of locations that a case can be stowed at Case Level warehouse
    },
    inventoryChecks: {
        maxUniqueBarcodes: 45,     // Approximate amount of total unique barcodes that we want to count for random inv checks
        rfidLessThanSystemDeltaQty1: 5,
        rfidLessThanSystemKmartOrRfidQty1: 12,
        rfidLessThanSystemDeltaQty2: 10,
        rfidLessThanSystemKmartOrRfidQty2: 12,
        rfidLessThanSystemPrice: 100,
        rfidGreaterThanSystemDeltaQty1: 10,
        rfidGreaterThanSystemKmartOrRfidQty1: 12,
        rfidGreaterThanSystemPrice: 100
        /**
         *  RFID qty is less than System qty and

                The difference between RFID qty and Kmart qty is >5 and either RFID or Kmart qty is < 12 OR

                The difference between RFID qty and Kmart qty is >10 and either RFID or Kmart qty is > 12 OR

                The COST difference between RFID qty and Kmart qty is >$100

            IF RFID qty is greater than System qty and

                The difference between RFID qty and Kmart qty is >10 and either RFID or Kmart qty is >12 OR

                The COST difference between RFID qty and Kmart qty is >$100
         */
    },
    PDU: {
        DCOrderDays: 4,
        WarehouseOrderDays: 1
    },
    inventoryBot: {
        maxInventoryUpdateHours: 6, // Number of hours old an inventory row must be such that we always update it based on the new TORY run data
        inventoryBotRunQualityThreshold: .9, // Minimum run quality below which we consider an error
        maxInventoryBotInventoryDifference: .15, // Maximum difference in Tag count compared to preverious run above which is considered an error
        getInventoryDataFileTimeout: 300000, // Maximun timeout in milliseconds for the tory getInventoryDataFile Api
        getToryMapTimeout: 300000, // Maximun timeout in milliseconds for the tory getMap Api
        defaultTimeoutForToryApis: 60000 // Maximun timeout in milliseconds for the tory Api helper function
    },
    RFID: {
        // Maximum Position difference where we consider the tag in the same location for backfill
        // If the X or Y position is different from the previous read by more then 3 meters, we consider the Tag in a different location
        // Therefore, we would not include the tag for backfill
        maxInventoryPositionDifference: 3,
        minVarianceExternalAndRFID: 1
    }
};
module.exports = settings;
