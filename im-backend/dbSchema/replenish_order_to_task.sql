DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `replenish_order_to_task`(
    IN inLocations VARCHAR(255), # store(s) that are being replenished
    IN isMan BOOLEAN, # is the order Manual
    IN inReplenID VARCHAR(25) # the specific replenish order that is being generated for, optional, manual only
    )
BEGIN
DROP TEMPORARY TABLE IF EXISTS ankowhm.location_base;
# Need to create temp table first and then insert into it. Create table AS (select ...) has a terrible performance on DEV
CREATE TEMPORARY TABLE ankowhm.location_base (
    ID VARCHAR(13) NOT NULL,
    WarehouseID VARCHAR(13) NOT NULL
);

IF (isMan)
THEN
    SET @oType := 'Manual';
ELSE
    SET @oType := 'Auto';
END IF;

IF (inLocations is not null)
THEN
    insert into ankowhm.location_base(ID, WarehouseID) select ID, WarehouseID from (
        SELECT distinct c.ID, loc.WarehouseID, DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)) as LocalDate
        FROM ankowhm.container c
        LEFT JOIN ankowhm.location loc ON loc.ID = c.ID
        LEFT JOIN ankowhm.replenish_schedule rs ON rs.LocationID = c.ID
        WHERE c.Type IN ('STR', 'WRH')
        HAVING FIND_IN_SET(c.ID, inLocations)
    ) as str_info;
ELSE
    INSERT INTO ankowhm.location_base(ID, WarehouseID) SELECT ID, WarehouseID FROM (
        SELECT c.ID, loc.WarehouseID,
            rs.Hour, HOUR(CONVERT_TZ(DATE_ADD(DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)), INTERVAL rs.Hour HOUR), loc.Timezone, 'UTC')) AS UtcHour,
            DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)) AS LocalDate
        FROM ankowhm.container c
        LEFT JOIN ankowhm.location loc ON loc.ID = c.ID
        LEFT JOIN ankowhm.replenish_schedule rs ON rs.LocationID = c.ID
        WHERE c.Type = 'STR'
        HAVING UtcHour = Hour(Now())
    ) AS str_info;
END IF;

SET @store_list = '';
SELECT GROUP_CONCAT(ID) INTO @store_list FROM ankowhm.location_base;

SELECT ro.*, ci.wrhTotalQty, IFNULL(taskQty, 0) taskQty, qtyFilled
FROM ankowhm.location_base AS str_info
INNER JOIN (
    SELECT ro.RowID, ro.Keycode, ro.SourceLocation, ro.TargetLocation, ro.Quantity, ro1.totalDemand, ro2.locationDemand, ro.Priority, ro.OrderType
    FROM (
        SELECT RowID, Keycode, SourceLocation, TargetLocation, Quantity, Priority, OrderType FROM ankowhm.replenish_order
        WHERE DateFulfilled IS NULL AND (ID = inReplenID OR inReplenID IS NULL)
    ) AS ro
    LEFT JOIN (
        SELECT SourceLocation, Keycode, SUM(Quantity) AS totalDemand
        FROM ankowhm.replenish_order
        WHERE DateFulfilled IS NULL AND FIND_IN_SET(TargetLocation, @store_list) AND (ID = inReplenID OR inReplenID IS NULL)
        GROUP BY SourceLocation, Keycode
    ) AS ro1 ON ro1.Keycode = ro.Keycode AND ro1.SourceLocation = ro.SourceLocation
    LEFT JOIN (
        SELECT SourceLocation, TargetLocation, Keycode, SUM(Quantity) AS locationDemand
        FROM ankowhm.replenish_order
        WHERE DateFulfilled IS NULL AND (ID = inReplenID OR inReplenID IS NULL)
        GROUP BY SourceLocation, TargetLocation, Keycode
    ) AS ro2 ON ro2.Keycode = ro.Keycode AND ro2.TargetLocation = ro.TargetLocation AND ro2.SourceLocation = ro.SourceLocation
) AS ro ON ro.TargetLocation = str_info.ID
LEFT JOIN (
    SELECT c.LocationID, i.ContainerID, i.Keycode, COUNT(*) AS wrhTotalQty
    FROM ankowhm.inventory i
    LEFT join ankowhm.container c on c.ID = i.ContainerID
    LEFT join ankowhm.container cp on cp.ID = c.LocationID
    INNER JOIN ankowhm.container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
    WHERE cp.Type = 'WRH' AND ct.isBoH = 1 AND ct.BackfillEnabled = 1 AND i.TaskID IS NULL
    GROUP BY c.LocationID, i.Keycode
) AS ci ON ro.SourceLocation = ci.LocationID AND ro.Keycode = ci.Keycode
LEFT JOIN (
    SELECT RowID, SUM(Quantity) taskQty, SUM(QuantityFilled) qtyFilled FROM ankowhm.task
    WHERE Type = 'Pick' # DateFulfilled IS NULL
    GROUP BY RowID
) AS t ON t.RowID = ro.RowID
WHERE wrhTotalQty IS NOT NULL AND Quantity > 0 AND (taskQty IS NULL OR Quantity > taskQty) AND ro.OrderType = @oType
ORDER BY SourceLocation, TargetLocation;

# Clean up
DROP TEMPORARY TABLE IF EXISTS ankowhm.location_base;

END//
DELIMITER ;
