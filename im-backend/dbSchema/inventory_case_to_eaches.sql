DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `inventory_case_to_eaches`(IN SourceContainer VARCHAR(13), IN UserID INT(11))
BEGIN
	DECLARE errno INT;
    DECLARE var_loop INT;
    DECLARE var_keycode INT;
    DECLARE var_qty INT;
    DECLARE ins_count INT;
	DECLARE done INT DEFAULT FALSE;
    DECLARE cursor_inventory CURSOR FOR
		SELECT b.Keycode, Sum(b.Quantity)
        FROM ankowhm.inventory_case ic
        INNER JOIN ankowhm.case_barcode b ON b.Barcode = ic.Barcode
        WHERE ic.ContainerID = SourceContainer
        GROUP BY Keycode;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
		SET ins_count = 0;
        SELECT ins_count;
		ROLLBACK;
    END;
    SET var_loop = 0;
    set ins_count = 0;
    proc_inventory: BEGIN

		DROP TEMPORARY TABLE IF EXISTS ankowhm.beforeAndAfter;

		CREATE TEMPORARY TABLE ankowhm.beforeAndAfter
		SELECT Barcode, NULL AS Keycode, Count(*) as Quantity
		FROM ankowhm.inventory_case
		WHERE ContainerID = SourceContainer
		GROUP BY Barcode
			UNION
		SELECT NULL as Barcode, b.Keycode, SUM(b.Quantity) as Quantity
		FROM ankowhm.inventory_case ic
		INNER JOIN ankowhm.case_barcode b on b.Barcode = ic.Barcode
		WHERE ContainerID = SourceContainer
		GROUP BY Keycode;

        IF NOT EXISTS (SELECT 1 FROM ankowhm.beforeAndAfter) THEN
			LEAVE proc_inventory;
		END IF;

		START TRANSACTION;
			OPEN cursor_inventory;

			inventory_loop: LOOP
				FETCH cursor_inventory INTO var_keycode, var_qty;
				IF done THEN
					LEAVE inventory_loop;
				END IF;
				WHILE var_loop < var_qty DO
					INSERT INTO ankowhm.inventory (ContainerID, Keycode, UserID) VALUES (SourceContainer, var_keycode, UserID);
					SET var_loop = var_loop + 1;
                    SET ins_count = ins_count + 1;
				END WHILE;
                SET var_loop = 0;
			END LOOP;

			DELETE FROM ankowhm.inventory_case WHERE ContainerID = SourceContainer;
			CLOSE cursor_inventory;
		COMMIT;
    END;
    SELECT ins_count;
    SELECT * FROM ankowhm.beforeAndAfter;
END//
DELIMITER ;
