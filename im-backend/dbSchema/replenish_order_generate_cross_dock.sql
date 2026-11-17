DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `replenish_order_generate_cross_dock`(
    IN inContainerID CHAR(13) # The RSV container in the warehouse that just had a Bulk Stow
)
BEGIN

SELECT
    str.Location,
    str.WarehouseID,
    str.DaysOfCoverage,
    wrh.Keycode,
    wrh.QtyTotal,
    IFNULL(cal.Factor, 1) AS Factor,
    IFNULL(oos.InventoryOOS, 0) AS InventoryOOS,
    IFNULL(sales.AWS, 0) AS AWS,
    IFNULL(sales.ADS, 0.01) AS ADS, # Average Daily Sales must be greater than 0, so new items can start at 0.1
    IFNULL(inv.QtyStore, 0) AS QtyStore,
    IFNULL(ro.QtyOrdered, 0) AS QtyOrdered,
    ankowhm.calc_mdu(mdu.MDU, str.StoreDefaultMDU, mdu.PDU, mdu.DateStartPDU, mdu.DateEndPDU, f.MDU) AS MDU,
    mdu.isExtAisle
FROM (
    # Get all Cross-Dock stores that are associated with this warehouse's RSV container
    SELECT
        loc.ID AS Location, # Store ID
        c.LocationID AS WarehouseID,
        DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)) AS LocalDate,
        loc.DaysOfCoverage,
        loc.isReplenishedByMDU,
        loc.StoreDefaultMDU
    FROM ankowhm.container c
    INNER JOIN ankowhm.location loc ON loc.WarehouseID = c.LocationID
    WHERE c.ID = inContainerID AND loc.isCrossDockEnabled = 1
) AS str
INNER JOIN (
   #  Get all available products (NULL TaskID) in the RCV container
    SELECT
        loc.ID AS WarehouseID,
        i.Keycode,
        COUNT(*) AS QtyTotal
    FROM ankowhm.inventory i
    INNER JOIN ankowhm.container c ON c.ID = i.ContainerID
    INNER JOIN ankowhm.location loc ON loc.ID = c.LocationID
    WHERE i.ContainerID = inContainerID AND i.TaskID IS NULL
    GROUP BY c.ID, i.Keycode
) AS wrh ON wrh.WarehouseID = str.WarehouseID
LEFT JOIN (
    # Get products that are out-of-stock
    SELECT
        st.Location,
        st.Keycode,
        MAX(st.InventoryOOS) AS InventoryOOS
    FROM ankowhm.sale_transaction st
    INNER JOIN ankowhm.location loc ON loc.ID = st.Location
    WHERE st.Date > (NOW() - INTERVAL 7 DAY)
    GROUP BY st.Location, st.Keycode
    HAVING InventoryOOS > 0
) AS oos ON oos.Location = str.Location AND oos.Keycode = wrh.Keycode
LEFT JOIN (
    # Get AWS and ADS (Average weekly and daily sales)
    SELECT
        st.Location,
        st.Keycode,
        COUNT(*) AS AWS,
        COUNT(*) / 7 AS ADS
    FROM ankowhm.sale_transaction st
    INNER JOIN ankowhm.location loc ON loc.ID = st.Location
    WHERE st.Date > (NOW() - INTERVAL 7 DAY)
    GROUP BY st.Location, st.Keycode
) AS sales ON sales.Location = str.Location AND sales.Keycode = wrh.Keycode
LEFT JOIN (
    # Get how much inventory the store currently has
    SELECT
        ContainerID,
        Keycode,
        COUNT(*) AS QtyStore
    FROM ankowhm.inventory
    GROUP BY ContainerID, Keycode
) AS inv ON inv.ContainerID = str.Location AND inv.Keycode = wrh.Keycode
LEFT JOIN (
    # Get the keycodes and their desired quantities for replenishment requests that haven't been fulfilled
    SELECT
        SourceLocation,
        TargetLocation,
        Keycode,
        SUM(Quantity) - SUM(IFNULL(QuantityFilled, 0)) AS QtyOrdered
    FROM ankowhm.replenish_order
    WHERE DateFulfilled IS NULL
    GROUP BY SourceLocation, TargetLocation, Keycode
) AS ro ON ro.TargetLocation = str.Location AND ro.SourceLocation = str.WarehouseID AND ro.Keycode = wrh.Keycode
LEFT JOIN ankowhm.product_blacklist bl ON str.Location = bl.LocationID AND wrh.Keycode = bl.Keycode
LEFT JOIN ankowhm.product_attr pa on pa.Keycode = wrh.Keycode
# TEMP CHANGE TO AVOID TABLE CHANGES
LEFT JOIN ankowhm.fixture_mdu f ON pa.Fixture_Code = f.Fixture_Code 
AND f.LocationID = 'DEFAULT'
# AND f.LocationID = str.Location
LEFT JOIN ankowhm.replenish_factor_calendar cal ON cal.LocationID = str.Location AND cal.Date = str.LocalDate
LEFT JOIN ankowhm.product_mdu AS mdu ON mdu.LocationID = str.Location AND mdu.Keycode = wrh.Keycode
LEFT JOIN ankowhm.product p ON p.Keycode = wrh.Keycode
WHERE
    bl.Keycode IS NULL                                                        # Exclude blacklisted products
    AND p.Sell_Price_Usd > 0                                                  # Exclude products that have a price of $0.00
    AND p.US_Overall_Test_Result_CONFIRMED in ('RELEASE','SELL THROUGH')      # Exclude products without a proper test result
    AND (pa.DateOnShowPlanned IS NOT NULL OR pa.DateOnShowActual IS NOT NULL) # Exclude products that don't have an on-show date
    AND NOW() >= IFNULL(pa.DateOnShowActual, pa.DateOnShowPlanned)            # Exclude products that aren't on-show yet
    AND (pa.DateOffShowActual IS NULL OR NOW() <= pa.DateOffShowActual)       # Exclude products that are past their on-show date
    # If isReplenishedByMDU = 0, then always replenish this keycode. If isReplenishedByMDU = 1, then only replenish this keycode if the following is true:
    # (It has an MDU > 0) OR (It has a PDU > 0, and that PDU is within the time range)
    AND (str.isReplenishedByMDU = 0 OR (str.isReplenishedByMDU = 1 AND ((IFNULL(CustomMDU, MDU) > 0) OR (PDU > 0 AND (NOW() >= DateStartPDU AND NOW() <= DateEndPDU)))))
ORDER BY Location;

END//
DELIMITER ;
