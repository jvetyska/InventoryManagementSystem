DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `backfill_generate_efficacy_report`(IN inLocationID VARCHAR(13))
BEGIN

DECLARE storeInventorySnapshotDate DATETIME
;
SELECT MAX(DateCreated) INTO storeInventorySnapshotDate
FROM ankowhm.store_inventory_snapshot
WHERE LocationID = inLocationID
;
DROP TEMPORARY TABLE IF EXISTS ankowhm.backfillEfficacyReport
;
CREATE TEMPORARY TABLE ankowhm.backfillEfficacyReport
# new one
SELECT
	loc.ID AS LocationID,
    loc.Timezone,
	p.Keycode,
	p.Product_Name,
	pd.Name AS Department_Name,
	ankowhm.calc_mdu(m.MDU, loc.StoreDefaultMDU, m.PDU, m.DateStartPDU, m.DateEndPDU, f.MDU) AS MDU,
    # OOS only if there is no FOH stock today and BOH stock today AND yesterday
	IF(IFNULL(currentInventory.FOHQuantity, 0) = 0
		AND IFNULL(yesterdayInventory.BOHQuantity, 0) > 0
		AND IFNULL(currentInventory.BOHQuantity, 0) > 0, 'OOS', 'In Stock') AS InOrOutOfStock,
	IFNULL(yesterdayInventory.FOHQuantity, 0) as FOHQuantityYesterday,
	IFNULL(yesterdayInventory.BOHQuantity, 0) as BOHQuantityYesterday,
	IFNULL(currentInventory.FOHQuantity, 0) as FOHQuantityCurrent,
	IFNULL(currentInventory.BOHQuantity, 0) as BOHQuantityCurrent,
    IF(ta.ID IS NOT NULL, 'Y', 'N') AS BackfillGenerated,
    # N/A if no Backfill task created, Y if a task was fulfilled, N if a task was created but not fulfilled
	IF(ta.ID IS NOT NULL, IF(IFNULL(ta.QuantityDelivered, 0) > 0, 'Y', 'N'), 'N/A') AS BackfillPerformed,
    # N/A if no Backfill task created, Y if a task was fulfilled AND current FOH is 0, otherwise N
    IF(ta.ID IS NOT NULL, IF(IFNULL(ta.QuantityDelivered, 0) > 0 AND
		IFNULL(currentInventory.FOHQuantity, 0) = 0, 'Y', 'N'), 'N/A') AS BackfilledButOutOfStockToday,
	IF(ta.ID IS NOT NULL, ta.Qty_Picked, 'N/A') AS Qty_Picked,
	IF(ta.ID IS NOT NULL, ta.Qty_Unavailable, 'N/A') AS Qty_Unavailable,
	IF(ta.ID IS NOT NULL, ta.Qty_Expired, 'N/A') AS Qty_Expired
FROM ankowhm.location loc
INNER JOIN ankowhm.container c ON loc.ID = c.LocationID
INNER JOIN ankowhm.inventory i ON c.ID = i.ContainerID
INNER JOIN ankowhm.product p On i.Keycode = p.Keycode
LEFT JOIN ankowhm.product_attr pa ON pa.Keycode = p.Keycode
# TEMP CHANGE TO AVOID TABLE CHANGES
LEFT JOIN ankowhm.fixture_mdu f ON pa.Fixture_Code = f.Fixture_Code 
AND f.LocationID = 'DEFAULT'
# AND f.LocationID = loc.ID
INNER JOIN ankowhm.product_department pd ON p.DepartmentID = pd.ID
LEFT JOIN ankowhm.product_mdu m ON m.Keycode = p.Keycode AND m.LocationID = loc.ID
# Get the Current FOH & BOH Inventory
LEFT JOIN (
	SELECT
		sis.Keycode,
		SUM(IF(ct.isBoH AND ct.BackfillEnabled, sis.QuantityBackfill, 0)) AS BOHQuantity,
        SUM(IF(ct.isFoH AND ct.BackfillEnabled, sis.Quantity, 0)) AS FOHQuantity
    FROM ankowhm.store_inventory_snapshot sis
    INNER JOIN ankowhm.container c ON sis.ContainerID = c.ID
    INNER JOIN ankowhm.container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType
    WHERE c.LocationID = inLocationID AND sis.DateCreated = storeInventorySnapshotDate
    GROUP BY sis.Keycode
) currentInventory ON currentInventory.Keycode = p.Keycode
# Get the Yesterday FOH & BOH inventory
LEFT JOIN (
	# SELECT FROM ankowhm.store_inventory_snapshot if it is available
	SELECT
		sis.Keycode,
		SUM(IF(ct.isBoH, QuantityBackfill, 0)) AS BOHQuantity,
        SUM(IF(ct.isFoH, Quantity, 0)) AS FOHQuantity
    FROM ankowhm.store_inventory_snapshot sis
    INNER JOIN ankowhm.container c ON sis.ContainerID = c.ID
    INNER JOIN ankowhm.container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType
    WHERE Date(sis.DateCreated) = Date(DATE_SUB(now(), INTERVAL 1 DAY))
		AND sis.LocationID = inLocationID AND ct.BackfillEnabled
	GROUP BY sis.Keycode
		UNION ALL
	# If there are no rows in store_inventory_snapshot, select the inventory from inventory_history
	SELECT
		ih.Keycode,
		SUM(IF(c.ID = inLocationID, ih.Quantity, 0)) AS FOHQuantity,
		SUM(IF(ct.isBoH = 1 AND ct.BackfillEnabled = 1, ih.Quantity, 0)) AS BOHQuantity
	FROM ankowhm.container c
	INNER JOIN ankowhm.container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
	# Joining this way to help with index
	INNER JOIN ankowhm.inventory_history ih ON ih.Date = DATE(NOW() - INTERVAL 1 DAY) AND
	c.LocationID = ih.LocationID AND c.ID = ih.ContainerID
	WHERE c.LocationID = inLocationID
		AND NOT EXISTS (
			SELECT 1
			FROM ankowhm.store_inventory_snapshot
			WHERE Date(DateCreated) = DATE(DATE_SUB(NOW(), INTERVAL 1 DAY)) AND LocationID = inLocationID
			LIMIT 1
		)
	GROUP BY ih.Keycode
) yesterdayInventory ON yesterdayInventory.Keycode = p.Keycode
# Get the task created for keycode yesterday
LEFT JOIN (
	SELECT
		t.ID,
		t.DateCompleted,
		t.Keycode,
        # We only care if there was any Backfill task fulfilled
        MAX(IFNULL(t.QuantityDelivered, 0)) AS QuantityDelivered,
        SUM(IFNULL(t.QuantityFilled, 0)) AS Qty_Picked,
        SUM(IF(t.DateCompleted IS NOT NULL AND t.AssignedUserID IS NOT NULL, t.Quantity - t.QuantityFilled, 0)) AS Qty_Unavailable,
        SUM(IF(t.DateCompleted IS NOT NULL AND t.AssignedUserID IS NULL, t.Quantity, 0)) AS Qty_Expired
	FROM ankowhm.task t
	INNER JOIN ankowhm.task_group tg ON t.TaskGroupID = tg.ID
	WHERE t.Type = 'Backfill' AND tg.TargetLocation = inLocationID
	AND Date(t.DateCreated) = Date(DATE_SUB(now(), INTERVAL 1 DAY))
	GROUP BY Keycode
) ta ON ta.Keycode = p.Keycode
WHERE loc.hasFHBH = 1
	AND loc.ID = inLocationID
GROUP BY loc.ID, p.Keycode
ORDER BY loc.ID, p.Keycode
;
SELECT * FROM ankowhm.backfillEfficacyReport
;
SELECT
	LocationID,
	FORMAT(IFNULL((totalInStock/TotalRows)*100, 100), 2) as InStockPercentage,
	FORMAT(IFNULL((totalOOSDueToSystemNotGeneratedBackfill/TotalRows)*100, 100), 2) as OOSDueToSystemNotGeneratingBackfill,
    FORMAT(IFNULL((totalOOSDueToBackfillNotPerformed/TotalRows)*100, 100), 2) as OOSDueToBackfillNotPerformed,
    FORMAT(IFNULL((totalOOSDueToMDU/TotalRows)*100, 100), 2) as OOSDueToLessMDU
FROM (
	SELECT
		LocationID,
		count(*) as TotalRows,
		SUM(case when InOrOutOfStock = 'In Stock' then 1 else 0 end ) as totalInStock,
		SUM(case when ( BackfillGenerated = 'N' AND InOrOutOfStock = 'OOS') then 1 else 0 end ) as totalOOSDueToSystemNotGeneratedBackfill,
		SUM( case when ( BackfillPerformed = 'N' AND InOrOutOfStock = 'OOS') then 1 else 0 end ) as totalOOSDueToBackfillNotPerformed,
		SUM( case when BackfilledButOutOfStockToday = 'Y' then 1 else 0 end ) as totalOOSDueToMDU
	FROM ankowhm.backfillEfficacyReport
) as metrics
;
END//
DELIMITER ;
