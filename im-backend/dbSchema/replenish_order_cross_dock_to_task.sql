DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `replenish_order_cross_dock_to_task`(
    IN inContainerID CHAR(13) # The RSV container in the warehouse that just had a Bulk Stow
)
BEGIN

SET @crossDockEnabledStores = NULL;
    
SELECT GROUP_CONCAT(loc.ID)
FROM ankowhm.container c
INNER JOIN ankowhm.location loc ON loc.WarehouseID = c.LocationID
WHERE c.ID = inContainerID AND loc.isCrossDockEnabled = 1
INTO @crossDockEnabledStores;

SELECT
    ro.*,
    ci.wrhTotalQty,
    IFNULL(taskQty, 0) AS taskQty,
    IFNULL(qtyFilled, 0) AS qtyFilled
FROM (
    SELECT loc.ID
    FROM ankowhm.container c
    INNER JOIN ankowhm.location loc ON loc.WarehouseID = c.LocationID
    WHERE c.ID = inContainerID AND loc.isCrossDockEnabled = 1
) AS str_info
INNER JOIN (
    SELECT
        ro.RowID,
        ro.Keycode,
        ro.SourceLocation,
        ro.TargetLocation,
        ro.Quantity,
        ro1.totalDemand,
        ro2.StoreDemand,
        ro.Priority,
        ro.OrderType
    FROM (
        # Get all CrossDock replenish orders that need to be fulfilled
        SELECT RowID, Keycode, SourceLocation, TargetLocation, Quantity, Priority, OrderType
        FROM ankowhm.replenish_order
        WHERE DateFulfilled IS NULL AND OrderType = 'CrossDock'
    ) AS ro
    LEFT JOIN (
        # Get the total demand of replenish orders across all stores
        SELECT SourceLocation, Keycode, SUM(Quantity) AS totalDemand
        FROM ankowhm.replenish_order
        WHERE DateFulfilled IS NULL AND FIND_IN_SET(TargetLocation, @crossDockEnabledStores)
        GROUP BY SourceLocation, Keycode
    ) AS ro1 ON ro1.Keycode = ro.Keycode AND ro1.SourceLocation = ro.SourceLocation
    LEFT JOIN (
        # Get the demand of each store 
        SELECT SourceLocation, TargetLocation, Keycode, SUM(Quantity) AS StoreDemand
        FROM ankowhm.replenish_order
        WHERE DateFulfilled IS NULL
        GROUP BY SourceLocation, TargetLocation, Keycode
    ) AS ro2 ON ro2.Keycode = ro.Keycode AND ro2.TargetLocation = ro.TargetLocation AND ro2.SourceLocation = ro.SourceLocation
) AS ro ON ro.TargetLocation = str_info.ID
LEFT JOIN (
    # Get the available inventory in the current RCV container
    SELECT c.LocationID, i.ContainerID, i.Keycode, COUNT(*) AS wrhTotalQty
    FROM ankowhm.inventory i
    LEFT join ankowhm.container c on c.ID = i.ContainerID
    LEFT join ankowhm.container cp on cp.ID = c.LocationID
    WHERE ContainerID = inContainerID AND i.TaskID IS NULL
    GROUP BY c.LocationID, i.Keycode
) AS ci ON ro.SourceLocation = ci.LocationID AND ro.Keycode = ci.Keycode
LEFT JOIN (
    # Get the requested quantity, and the quantity filled from the tasks for each unique Row ID in replenish_order
    SELECT RowID, SUM(Quantity) AS taskQty, SUM(QuantityFilled) qtyFilled
    FROM ankowhm.task
    WHERE Type = 'CrossDock' AND DateCompleted IS NULL
    GROUP BY RowID
) AS t ON t.RowID = ro.RowID
WHERE
    wrhTotalQty IS NOT NULL
    AND Quantity > 0
    AND (taskQty IS NULL OR Quantity > taskQty)
    AND ro.OrderType = 'CrossDock'
ORDER BY SourceLocation, TargetLocation;

END//
DELIMITER ;
