const SortEnum = {
    TOTAL_RFID_QUANTITY_ASC: "totalRFIDQuantityASC",
    TOTAL_RFID_QUANTITY_DSC: "totalRFIDQuantityDSC",
    DELTA_QUANTITY_ASC: "deltaQuantityASC",
    DELTA_QUANTITY_DSC: "deltaQuantityDSC"
}

const sortTaskData = (taskGenerationData, sortBy) => {
    switch (sortBy) {
        case SortEnum.TOTAL_RFID_QUANTITY_ASC:
            return taskGenerationData.sort((a, b) => a.TotalRFIDQuantity - b.TotalRFIDQuantity);
        case SortEnum.TOTAL_RFID_QUANTITY_DSC:
            return taskGenerationData.sort((a, b) => b.TotalRFIDQuantity- a.TotalRFIDQuantity);
        case SortEnum.DELTA_QUANTITY_ASC:
            return taskGenerationData.sort((a, b) => a.DeltaQuantity - b.DeltaQuantity);
        case SortEnum.DELTA_QUANTITY_DSC:
            return taskGenerationData.sort((a, b) => b.DeltaQuantity - a.DeltaQuantity);
        default:
            return taskGenerationData.sort((a, b) => a.TotalRFIDQuantity - b.TotalRFIDQuantity);
    }
}

module.exports = { sortTaskData, SortEnum }