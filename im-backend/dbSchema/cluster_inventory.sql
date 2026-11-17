DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `cluster_inventory`(IN in_location VARCHAR(13), IN in_productID VARCHAR(13), IN in_keycode INT8)
BEGIN
SET @keycode = in_keycode;
SET @warehouse = NULL;

# Ensure we have Keycode
IF (@keycode IS NULL)
THEN
    SELECT p.Keycode INTO @keycode FROM ankowhm.product p INNER JOIN ankowhm.product_barcode pb ON pb.Keycode = p.Keycode WHERE pb.Barcode = in_productID;
END IF;
# Set WarehouseID
SELECT IFNULL(WarehouseID, ID) INTO @warehouse FROM ankowhm.location WHERE ID = in_location;

SELECT c.ID AS Location, @keycode AS Keycode, IFNULL(i.Qty, 0) AS Quantity, loc.incoming
FROM ankowhm.container c
INNER JOIN (
    SELECT loc.ID, loc.WarehouseID, loc.isOpen, (
        SELECT SUM(IFNULL(t.QuantityFilled, t.Quantity))
        FROM ankowhm.task t
        INNER JOIN ankowhm.task_group tg ON tg.ID = t.TaskGroupID
        WHERE t.Type = 'Pick' AND t.Keycode = @keycode AND tg.TargetLocation = loc.ID
            AND t.DateFulfilled IS NULL
    ) AS incoming
    FROM ankowhm.location loc
) loc ON loc.ID = c.ID
LEFT JOIN (
    SELECT i.ContainerID, i.Keycode, count(*) AS Qty FROM ankowhm.inventory i
    LEFT JOIN ankowhm.container c ON c.ID = i.ContainerID
    WHERE i.Keycode = @keycode AND c.Type = 'STR' AND i.TaskID IS null
    GROUP BY i.ContainerID, i.Keycode
) AS i ON i.ContainerID = c.ID
WHERE loc.WarehouseID = @warehouse
AND c.Type = 'STR' AND loc.isOpen = true
UNION
## Available in the Warehouse:
SELECT c.ID AS Location, @keycode AS Keycode, IFNULL(Qty, 0) AS Quantity, ic.incoming
FROM ankowhm.container c
LEFT JOIN (
    SELECT c.ParentID, i.Keycode, count(*) AS Qty FROM ankowhm.inventory i
    LEFT JOIN ankowhm.container c ON c.ID = i.ContainerID
    WHERE c.ParentID = @warehouse
    AND c.Type IN ('SHL', 'RSV', 'CRT') AND i.Keycode = @keycode AND i.TaskID IS NULL
    GROUP BY c.ParentID
) AS i ON i.ParentID = c.ID
## Incoming to the Warehouse:
LEFT JOIN (
    SELECT @warehouse AS ID, SUM(incoming) AS incoming FROM (
        ## Incoming inventory or inventory_case
        SELECT SUM(IFNULL(t.QuantityFilled, t.Quantity) * IFNULL(cb.Quantity, 1)) AS incoming
        FROM ankowhm.task t
        INNER JOIN ankowhm.task_group tg ON tg.ID = t.TaskGroupID
        LEFT JOIN ankowhm.case_barcode cb ON t.Barcode = cb.Barcode
        WHERE t.Type IN ('Pick', 'CasePick')
            AND (cb.Keycode = @keycode OR t.Keycode = @keycode)
            AND tg.TargetLocation = @warehouse
            AND t.DateFulfilled IS NULL
        UNION ALL
        ## RCV location at the Warehouse counts as Incoming
        SELECT IFNULL(count(*), 0) AS incoming
        FROM ankowhm.inventory i
        INNER JOIN ankowhm.container c on c.ID = i.ContainerID
        WHERE c.ParentID = @warehouse
        AND c.Type = 'RCV' AND i.Keycode = @keycode
        GROUP BY c.ParentID
    ) AS incoming
) AS ic ON ic.ID = c.ID
WHERE c.ID = @warehouse AND c.ID != 'FIF1-WRH'
UNION
SELECT 'FIF1-WRH (DC)' as Location, p.Keycode, IFNULL(c.Quantity, 0) AS Quantity, NULL AS incoming
FROM ankowhm.product p
LEFT JOIN (
    SELECT Keycode, SUM(IFNULL(Quantity, 0)) AS Quantity FROM (
        SELECT Keycode, SUM(IFNULL(Quantity, 0)) AS Quantity
        FROM (
            SELECT b.Keycode, SUM(b.Quantity) AS Quantity
            FROM ankowhm.inventory_case i
            INNER JOIN ankowhm.case_barcode b ON i.Barcode = b.Barcode
            INNER JOIN ankowhm.container c on c.ID = i.ContainerID
            INNER JOIN ankowhm.container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
            WHERE ct.isBoH = 1 AND ct.BackfillEnabled = 1 AND i.TaskID IS NULL
            GROUP BY b.Keycode
        ) AS i
        GROUP BY Keycode
        UNION ALL
        SELECT i.keycode, IFNULL(count(*), 0) AS Quantity
        FROM ankowhm.inventory i
        INNER JOIN ankowhm.container c on c.ID = i.ContainerID
        INNER JOIN ankowhm.container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
        WHERE c.ParentID = 'FIF1-WRH'
        AND ct.isBoH = 1 AND ct.BackfillEnabled = 1 AND i.Keycode = @keycode AND i.TaskID IS NULL
        GROUP BY i.Keycode
    ) AS dc
    GROUP BY dc.keycode
) AS c ON p.Keycode = c.Keycode
WHERE p.Keycode = @keycode
;

END//
DELIMITER ;
