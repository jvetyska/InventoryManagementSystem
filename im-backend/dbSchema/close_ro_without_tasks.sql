DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `close_ro_without_tasks`()
BEGIN
    DECLARE closedReplenish INT;
    # This is to close all replenish orders that do not have associated tasks. 
    # This is to prevent buildup of old unfulfillable tasks. 
    UPDATE ankowhm.replenish_order ro
    INNER JOIN ankowhm.container c on c.ID = ro.TargetLocation AND c.Type = 'WRH'
    LEFT JOIN (
        SELECT ro2.RowID
        FROM ankowhm.replenish_order ro
        INNER JOIN ankowhm.container c on c.ID = ro.TargetLocation AND c.Type = 'WRH'
        INNER JOIN ankowhm.task t on t.RowID = ro.RowID and t.type in ( 'CasePick', 'Pick')
        INNER JOIN ankowhm.case_barcode b on t.Barcode = b.Barcode
        INNER JOIN ankowhm.replenish_order ro2 on b.Keycode = ro2.Keycode AND ro.ID = ro2.ID
        WHERE ro.DateFulfilled is null
        GROUP BY ro2.RowID
    ) as t on t.RowID = ro.RowID
    SET QuantityFilled = 0, DateFulfilled = NOW()
    # Interval of 5 mins to prevent race condition with new orders
    WHERE t.RowID is null AND ro.DateFulfilled is null AND ro.DateCreated < NOW() - INTERVAL -5 minute;
    
    SET closedReplenish = ROW_COUNT();
    
    SELECT closedReplenish;
END//
DELIMITER ;
