DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `replenish_case_to_task`(
    IN inWarehouse VARCHAR(255), # Warehouse that is being replenished
    IN isMan BOOLEAN, # is the order Manual
    IN inReplenID VARCHAR(25) # the specific replenish order that is being generated for, optional, manual only
)
BEGIN

# Get the warehouse source that will replenish the targeted warehouse
IF(inReplenID is not null)
THEN
    SET @WarehouseSource = (SELECT DISTINCT SourceLocation AS WarehouseID FROM ankowhm.replenish_order WHERE ID = inReplenID);
ELSE
    SET @warehouseSource = (SELECT DCLocationID AS WarehouseID FROM ankowhm.location WHERE ID = inWarehouse);
END if;

IF (isMan)
THEN
    SET @oType = 'Manual';
ELSE
    SET @oType = 'Auto';
END IF;

# 1. Get available products that can be assigned to a task in the table: inventory
SELECT i.ContainerID, i.Keycode, COUNT(*) AS Quantity
FROM ankowhm.inventory i
INNER JOIN ankowhm.container c ON c.ID = i.ContainerID
WHERE i.TaskID IS NULL AND c.Type IN ('RSV') AND c.LocationID = @warehouseSource
GROUP BY i.ContainerID, i.Keycode;

# 2. Get available cases that can be assigned to a task in the table: inventory_case
SELECT
    ic.Barcode,
    ic.ContainerID,
    ic.CaseCount,
    GROUP_CONCAT(Keycode) AS 'Keycodes',
    GROUP_CONCAT(Quantity) AS 'Quantities'
FROM (
    SELECT ic.ContainerID, ic.Barcode, COUNT(*) AS CaseCount
    FROM ankowhm.inventory_case ic
    INNER JOIN ankowhm.container c ON c.ID = ic.ContainerID
    WHERE ic.TaskID IS NULL AND c.Type = 'RSV' AND c.LocationID = @warehouseSource
    GROUP BY ic.ContainerID, ic.Barcode
) AS ic
LEFT JOIN ankowhm.case_barcode cb ON cb.Barcode = ic.Barcode
GROUP BY ic.ContainerID, ic.Barcode;

# 3. Subtract how many keycodes we already have allocated in tasks from the demand of keycodes that need to be fulfilled
SELECT
    a.Keycode,
    a.Demand,
    IFNULL(b.CurrentlyAllocated, 0) AS CurrentlyAllocated,
    GREATEST((a.Demand - IFNULL(b.CurrentlyAllocated, 0)), 0) AS TotalDemand,
    a.OutOfStock,
    a.ClusterWrhInventory
FROM (
    # Get the total demand of all keycodes that need to be fulfilled, and whether or not they are out of stock
    SELECT
        ro.Keycode,
        IF(ro.Quantity = 1 AND cb.Quantity > 1, 2, ro.Quantity) AS Demand,
        IF(MIN(ro.TargetInventory) = 0, TRUE, FALSE) AS OutOfStock,
        ro.ClusterWrhInventory
    FROM ankowhm.replenish_order AS ro
    INNER JOIN ankowhm.case_barcode AS cb ON cb.Keycode = ro.Keycode
    WHERE ro.DateFulfilled IS NULL AND ro.TargetLocation = inWarehouse AND (ro.ID = inReplenID OR inReplenID IS NULL)
    GROUP BY ro.SourceLocation, ro.TargetLocation, ro.Keycode ORDER BY ro.Keycode ASC
) AS a
LEFT JOIN (
    # Get the keycodes that are already allocated in a task
    SELECT
        k.Keycode,
        SUM(k.TotalQuantity) AS CurrentlyAllocated
    FROM (
        SELECT cb.Keycode, (t.Quantity * cb.Quantity) AS TotalQuantity
        FROM ankowhm.task_group tg
        INNER JOIN ankowhm.task t ON t.TaskGroupID = tg.ID
        INNER JOIN ankowhm.case_barcode cb ON (cb.Barcode = t.Barcode OR cb.Barcode = t.ProductID)
        INNER JOIN ankowhm.replenish_order ro ON ro.RowID = t.RowID
        # ^ ProductID is still in the process of being transferred over to Barcode, so we need to check both columns
        WHERE tg.SourceLocation = @warehouseSource AND tg.TargetLocation = inWarehouse AND t.DateFulfilled IS NULL AND (ro.ID = inReplenID OR inReplenID IS NULL)
    ) AS k
    GROUP BY k.Keycode
) AS b ON b.Keycode = a.Keycode;

# 4. Get the data that maps case barcodes to row IDs
SELECT ro.Keycode AS Code, ro.RowID
FROM ankowhm.replenish_order ro
WHERE ro.DateFulfilled IS NULL AND ro.TargetLocation = inWarehouse AND (ro.ID = inReplenID OR inReplenID IS NULL)
GROUP BY ro.Keycode
UNION
SELECT cb.Barcode AS Code, ro.RowID
FROM ankowhm.replenish_order ro
INNER JOIN ankowhm.case_barcode cb ON cb.Keycode = ro.Keycode
WHERE ro.DateFulfilled IS NULL AND ro.TargetLocation = inWarehouse AND (ro.ID = inReplenID OR inReplenID IS NULL)
GROUP BY cb.Barcode;

END//
DELIMITER ;
