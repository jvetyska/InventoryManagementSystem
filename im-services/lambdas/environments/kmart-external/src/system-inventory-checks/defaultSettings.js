const settings = {
    inventoryChecks: {
        rfidLessThanSystemDeltaQty1: 5,
        rfidLessThanSystemKmartOrRfidQty1: 12,
        rfidLessThanSystemDeltaQty2: 10,
        rfidLessThanSystemKmartOrRfidQty2: 12,
        rfidLessThanSystemPrice: 100,
        rfidGreaterThanSystemDeltaQty1: 10,
        rfidGreaterThanSystemKmartOrRfidQty1: 12,
        rfidGreaterThanSystemPrice: 100
    },
    inventoryTasksSort: "totalRFIDQuantityASC"
};

module.exports = settings;
