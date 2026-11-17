DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `replenish_order_generate`()
BEGIN
###  REPLENISH_ORDER_GENERATE ()  ####
# Step 0: str - Get store details and associated Warehouse based on current hour and replenish_schedule.
# Step 1: wrh - Add total warehouse quantity of items per warehouses in str.
# Step 2: sales - In the sale_transaction table, get the sum of quantity ordered in the past 7 days.
#         - Calculate Average daily sales, mix in InventoryOOS
# Step 3: inv - Add current inventory levels per store
# Step 4: ro - Add current replenish_order levels for products
# Step 5: p - get more product details.
# Step 6: cal - get replenish_order_calendar factor
# Step 7: bl - remove all product that is currently on the product_blacklist
SELECT
    str.Location,
    wrh.WarehouseID,
    wrh.Keycode,
    wrh.wrhTotalQty,
    IFNULL(cal.Factor, 1) AS factor,
    ankowhm.calc_mdu(mdu.MDU, str.StoreDefaultMDU, mdu.PDU, mdu.DateStartPDU, mdu.DateEndPDU, f.MDU) AS MDU,
    aws.AWS,
    aws.AWS / 7 AS AverageDailySales,
    oos.invOOS,
    inv.TargetInventory,
    ro.QuantityOrdered,
    str.DaysOfCoverage,
    mdu.isExtAisle
FROM (
    SELECT
        c.ID AS Location,
        loc.WarehouseID,
        rs.Hour,
        loc.DaysOfCoverage,
        loc.StoreDefaultMDU,
        loc.isReplenishedByMDU,
        HOUR(CONVERT_TZ(DATE_ADD(DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)), INTERVAL rs.Hour HOUR), loc.Timezone, 'UTC')) AS UtcHour,
        DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)) AS LocalDate
    FROM ankowhm.container c
    INNER JOIN ankowhm.replenish_schedule rs ON rs.LocationID = c.ID
    LEFT JOIN ankowhm.location loc ON loc.ID = c.ID
    WHERE c.Type = 'STR'
    HAVING UtcHour = Hour(Now())
) AS str
INNER JOIN (
    SELECT cp.ID AS WarehouseID, i.Keycode, count(*) AS wrhTotalQty
    FROM ankowhm.inventory i
    LEFT JOIN ankowhm.container c on c.ID = i.ContainerID
    LEFT JOIN ankowhm.container cp on cp.ID = c.LocationID
    INNER JOIN ankowhm.container_type ct ON ct.ID = c.Type AND ct.SubType <=> c.SubType # <=> is a NULL-safe comparer
    WHERE cp.Type = 'WRH' AND ct.isBoH = 1 AND ct.BackfillEnabled = 1
    AND i.TaskID IS NULL
    GROUP BY cp.ID, i.Keycode
) AS wrh ON wrh.WarehouseID = str.WarehouseID
LEFT JOIN (
    SELECT st.Location, p.Keycode, max(st.InventoryOOS) AS invOOS
    FROM ankowhm.sale_transaction st
    INNER JOIN ankowhm.product_barcode pb ON pb.Barcode = st.ProductID
    INNER JOIN ankowhm.product p ON p.Keycode = pb.Keycode
    INNER JOIN ankowhm.location loc ON loc.ID = st.Location
    WHERE st.Date > (NOW() - INTERVAL 1 DAY) AND st.ProductID IS NOT NULL
    GROUP BY st.Location, p.Keycode
    HAVING invOOS > 0 # ------   optional
) AS oos ON oos.Location = str.Location AND oos.Keycode = wrh.Keycode
LEFT JOIN ankowhm.product_aws AS aws ON aws.LocationID = str.Location AND aws.Keycode = wrh.Keycode
LEFT JOIN ankowhm.product_mdu AS mdu ON mdu.LocationID = str.Location AND mdu.Keycode = wrh.Keycode
LEFT JOIN (
    SELECT ContainerID, Keycode, count(*) AS TargetInventory
    FROM ankowhm.inventory
    GROUP BY ContainerID, Keycode
) AS inv ON inv.ContainerID = str.Location AND inv.Keycode = wrh.Keycode
LEFT JOIN (
    SELECT SourceLocation, TargetLocation, Keycode, sum(Quantity) - SUM(IFNULL(QuantityFilled, 0)) AS QuantityOrdered
    FROM ankowhm.replenish_order
    WHERE DateFulfilled IS NULL
    GROUP BY SourceLocation, TargetLocation, Keycode
) AS ro ON ro.TargetLocation = str.Location AND ro.SourceLocation = str.WarehouseID AND ro.Keycode = wrh.Keycode
INNER JOIN ankowhm.product p ON p.Keycode = wrh.Keycode AND p.Sell_Price_Usd > 0
LEFT JOIN ankowhm.product_attr pa on pa.Keycode = p.Keycode
# TEMP CHANGE TO AVOID TABLE CHANGES
LEFT JOIN ankowhm.fixture_mdu f ON pa.Fixture_Code = f.Fixture_Code 
AND f.LocationID = 'DEFAULT'
# AND f.LocationID = str.Location
LEFT JOIN ankowhm.replenish_factor_calendar cal ON cal.LocationID = str.Location AND cal.Date = str.LocalDate
LEFT JOIN ankowhm.product_blacklist bl ON str.Location = bl.LocationID AND wrh.Keycode = bl.Keycode
WHERE bl.Keycode IS NULL # Exclude BlackList
# If isReplenishedByMDU = 0, then always replenish this keycode. If isReplenishedByMDU = 1, then only replenish this keycode if the following is true:
# (It has an MDU > 0) OR (It has a PDU > 0, and that PDU is within the time range)
AND (str.isReplenishedByMDU = 0 OR (str.isReplenishedByMDU = 1 AND ((IFNULL(CustomMDU, MDU) > 0) OR (PDU > 0 AND (NOW() >= DateStartPDU AND NOW() <= DateEndPDU)))))
AND (pa.DateOnShowPlanned IS NOT NULL OR pa.DateOnShowActual IS NOT NULL)
AND NOW() >= IFNULL(pa.DateOnShowActual, pa.DateOnShowPlanned)
AND (pa.DateOffShowActual IS NULL OR NOW() <= pa.DateOffShowActual)
AND p.US_Overall_Test_Result_CONFIRMED in ('RELEASE','SELL THROUGH')
ORDER BY Location;
END//
DELIMITER ;
