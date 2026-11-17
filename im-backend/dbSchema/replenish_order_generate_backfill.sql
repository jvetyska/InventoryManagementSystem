DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `replenish_order_generate_backfill`(
    IN inBackfillScheduleID INT(11) # Backfill schedule ID to generate backfill tasks for
)
BEGIN

DECLARE tasksUpdated INT;
DECLARE taskGroupsCompleted INT;
DECLARE containerIDs VARCHAR(500);
DECLARE storeID VARCHAR(13);

# Get the Back-of-House container IDs
SELECT
    GROUP_CONCAT(DISTINCT c.ID) INTO containerIDs
FROM (
    SELECT
        ibb.ContainerID
    FROM ankowhm.inventory_take_schedule its
    INNER JOIN ankowhm.inventory_bot ib ON its.InventoryBotID = ib.ID
    INNER JOIN ankowhm.inventory_bot_boundary ibb ON ib.LocationID = ibb.LocationID AND ib.DefaultMap = ibb.Map
    WHERE
        its.BackfillScheduleID = inBackfillScheduleID
        AND its.Type = 'InventoryBot'
    UNION
    SELECT IFNULL(iba.ContainerID, its.ContainerID) AS ContainerID
    FROM ankowhm.inventory_take_schedule its
    LEFT JOIN ankowhm.inventory_bot_area iba ON its.InventoryBotArea = iba.Area AND its.InventoryBotID = iba.InventoryBotID
    WHERE
        its.BackfillScheduleID = inBackfillScheduleID
) containers
INNER JOIN ankowhm.container c ON c.ID = containers.ContainerID
INNER JOIN ankowhm.container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
WHERE ct.isBoH IS TRUE AND ct.BackfillEnabled IS TRUE;

# Get the Front-of-House store ID
SELECT LocationID INTO storeID
FROM ankowhm.store_backfill_schedule
WHERE ID = inBackfillScheduleID;

# First complete the task and task_group for the backfillScheduleID.
UPDATE ankowhm.task t
INNER JOIN ankowhm.task_group tg ON t.TaskGroupID = tg.ID
SET
	t.DateCompleted = IFNULL(t.DateCompleted, NOW()),
    t.QuantityFilled = IFNULL(t.QuantityFilled, 0),
    t.DateFulfilled = IFNULL(t.DateFulfilled, NOW()),
    t.QuantityDelivered = IFNULL(t.QuantityDelivered, 0)
WHERE
	(t.DateCompleted IS NULL OR t.DateFulfilled IS NULL)
    AND t.Type = 'Backfill'
    AND tg.ReferenceID = inBackfillScheduleID
;
SET tasksUpdated = ROW_COUNT()
;
# Also close tasks in the same location that are older than 12 hours
UPDATE ankowhm.task t
INNER JOIN ankowhm.container c ON t.SourceContainer = c.ID
SET
	t.DateCompleted = IFNULL(t.DateCompleted, NOW()),
    t.QuantityFilled = IFNULL(t.QuantityFilled, 0),
    t.DateFulfilled = IFNULL(t.DateFulfilled, NOW()),
    t.QuantityDelivered = IFNULL(t.QuantityDelivered, 0)
WHERE
	t.Type = 'Backfill'
    AND c.LocationID = storeID
    AND t.DateCreated < NOW() - INTERVAL 12 HOUR
    AND (t.DateCompleted IS NULL OR t.DateFulfilled IS NULL)
;
SET tasksUpdated = tasksUpdated + ROW_COUNT()
;
UPDATE ankowhm.task_group
SET
	DateCompleted = IFNULL(DateCompleted, NOW()),
    DateFulfilled = IFNULL(DateFulfilled, NOW())
WHERE
    (DateCompleted IS NULL OR DateFulfilled IS NULL)
    AND Type = 'Backfill'
    AND ReferenceID = inBackfillScheduleID
;
SET taskGroupsCompleted = ROW_COUNT()
;
UPDATE ankowhm.task_group
SET
	DateCompleted = IFNULL(DateCompleted, NOW()),
    DateFulfilled = IFNULL(DateFulfilled, NOW())
WHERE
	Type = 'Backfill'
    AND SourceLocation = storeID
    AND DateCreated < NOW() - INTERVAL 12 HOUR
    AND (DateCompleted IS NULL OR DateFulfilled IS NULL)
;
SET taskGroupsCompleted = taskGroupsCompleted + ROW_COUNT()
;

SELECT tasksUpdated, taskGroupsCompleted
;

SELECT
    str.LocationID,
    inv.ContainerID AS SourceContainer,
    inv.Keycode,
    inv.ReferenceID,
    # CONCAT(pd.Name, ' ', p.Class_Name, ' ', Sub_Class_Name) AS SecondarySort,
    CONCAT(IFNULL(p.Business_Unit_RBU_Name, ''), ' ', IFNULL(pa.Fixture_Code, ''), ' ', IFNULL(pa.Table_Code, ''), ' ', IFNULL(pd.Name, ''), ' ', IFNULL(p.Class_Name, ''), ' ', IFNULL(p.Style_ID, ''), ' ', IFNULL(p.Secondary_Colour, '')) AS SecondarySort,
    # The amount of stock we need to bring from BOH to FOH: MDU - Quantity of tasks currently allocated - StockFOH
    # Do not allow the task to allocate more quantity that what currently exists in the BOH
    inv.Stock AS StockBOH,
    ankowhm.calc_mdu(mdu.MDU, str.StoreDefaultMDU, mdu.PDU, mdu.DateStartPDU, mdu.DateEndPDU, f.MDU) as MDU,
    ankowhm.calc_mdu(mdu.MDU, str.StoreDefaultMDU, mdu.PDU, mdu.DateStartPDU, mdu.DateEndPDU, f.MDU) - totalInv.StockFOH - IFNULL(existingTasks.Quantity, 0) AS StockWanted
FROM (
    SELECT
        ID AS LocationID,
        StoreDefaultMDU
    FROM ankowhm.location
    WHERE ID = storeID
) AS str
# Get inventory for BOH containers
INNER JOIN (
	SELECT
		sis.ID AS ReferenceID,
		sis.LocationID,
		sis.Keycode,
        sis.ContainerID,
		sis.QuantityBackfill AS Stock
    FROM ankowhm.store_inventory_snapshot sis
    INNER JOIN ankowhm.container c ON sis.ContainerID = c.ID
    INNER JOIN ankowhm.container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType
    WHERE sis.BackfillScheduleID = inBackfillScheduleID AND ct.BackfillEnabled AND ct.isBoH AND sis.DateCompleted IS NULL
    GROUP BY sis.Keycode, sis.ContainerID
    HAVING Stock > 0
) inv ON str.LocationID = inv.LocationID
# Get total FOH and BOH inventory
INNER JOIN (
	SELECT
		sis.Keycode,
		SUM(IF(ct.isBoH, sis.QuantityBackfill, 0)) AS StockBOH,
        SUM(IF(ct.isFoH, sis.Quantity, 0)) AS StockFOH
    FROM ankowhm.store_inventory_snapshot sis
    INNER JOIN ankowhm.container c ON sis.ContainerID = c.ID
    INNER JOIN ankowhm.container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType
    WHERE sis.BackfillScheduleID = inBackfillScheduleID AND sis.DateCompleted IS NULL AND ct.BackfillEnabled
    GROUP BY sis.Keycode
    HAVING StockBOH > 0
) totalInv ON totalInv.Keycode = inv.Keycode
LEFT JOIN (
    SELECT
        tasks.Keycode,
        tasks.LocationID,
        tasks.QuantityFilled + LEAST(tasks.QuantityNotFilled, IFNULL(i.inventoryCount, 0)) AS Quantity
    FROM (
        SELECT
            t.Keycode,
            t.SourceContainer AS ContainerID,
            c.LocationID,
            SUM(IF(t.DateCompleted IS NULL, t.Quantity, 0)) AS QuantityNotFilled,
            IFNULL(SUM(t.QuantityFilled), 0) AS QuantityFilled
        FROM ankowhm.task t
        INNER JOIN ankowhm.container c ON t.SourceContainer = c.ID
        WHERE t.Type = 'Backfill' AND t.DateFulfilled IS NULL AND c.LocationID = storeID
        GROUP BY t.Keycode, c.ID
    ) tasks
    LEFT JOIN (
        SELECT
            i.ContainerID,
            i.Keycode,
            COUNT(*) AS inventoryCount
        FROM ankowhm.inventory i
        WHERE FIND_IN_SET(i.ContainerID, containerIDs)
        GROUP BY i.Keycode, i.ContainerID
    ) i ON tasks.ContainerID = i.ContainerID AND tasks.Keycode = i.Keycode
    GROUP BY tasks.LocationID, tasks.Keycode
    HAVING Quantity > 0
) AS existingTasks ON existingTasks.LocationID = str.LocationID AND existingTasks.Keycode = inv.Keycode
# Get various product information from the tables product and product_mdu
INNER JOIN ankowhm.product p ON p.Keycode = inv.Keycode
LEFT JOIN ankowhm.product_attr pa ON pa.Keycode = p.Keycode
# TEMP CHANGE TO AVOID TABLE CHANGES
LEFT JOIN ankowhm.fixture_mdu f ON pa.Fixture_Code = f.Fixture_Code
AND f.LocationID = 'DEFAULT'
# AND f.LocationID = str.LocationID
INNER JOIN ankowhm.product_department pd ON p.DepartmentID = pd.ID
LEFT JOIN ankowhm.product_mdu AS mdu ON mdu.LocationID = str.LocationID AND mdu.Keycode = inv.Keycode
WHERE p.isRecall = 0 # Filter out rows that are set to recall, as recalled products should NOT be included in the backfill
HAVING StockWanted > 0 # Filter out rows where we do NOT want any stock
ORDER BY str.LocationID DESC, inv.Keycode ASC, inv.ContainerID ASC
;

END//
DELIMITER ;