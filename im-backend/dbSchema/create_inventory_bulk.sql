DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `create_inventory_bulk`(
    IN inBarcode CHAR(13),   # This will be a Keycode for a "product" type, or a Barcode for a "case" type
    IN inKeycode INT(8),         # Keycode, when provided, not need to lookup Barcode.
    IN inContainer CHAR(13), # The ID of the container to create inventory in
    IN inQuantity INT,       # The amount of inventory to create
    IN inUserId INT          # The ID of the user that's executing this
)
BEGIN

DECLARE i INT;
SET i = 1;
SET @sql = NULL;
SET @keycode = null;
SET @caseBarcode = NULL;

# We will need to execute both SELECT queries in order to determine if this is a "product" or "case" type
IF (inKeycode IS NULL) THEN  # When keycode is not provided, lookup Barcode and get either Keycode or case barcode.
    SELECT p.Keycode INTO @keycode FROM ankowhm.product p INNER JOIN ankowhm.product_barcode pb ON pb.Keycode = p.Keycode WHERE pb.Barcode = inBarcode;
    SELECT DISTINCT Barcode INTO @caseBarcode FROM ankowhm.case_barcode WHERE Barcode = inBarcode;
ELSE
    SELECT Keycode INTO @keycode FROM ankowhm.product WHERE Keycode = inKeycode;
END IF;


IF (@keycode IS NOT NULL) THEN # This is a "product" type
    SET @sql = CONCAT('INSERT INTO ankowhm.inventory (ContainerID, Keycode, ProductID, UserID) VALUES (', QUOTE(inContainer), ', ', @keycode,', ', QUOTE(inBarcode), ', ', inUserId, ')');
    # IF Quantity > 1, Add values for the other items
    WHILE i < inQuantity DO
        SET @sql = CONCAT(@sql,  ', (', QUOTE(inContainer), ', ', IFNULL(@keycode, 'null'), ', ', QUOTE(inBarcode), ', ', inUserId, ')');
        SET i = i + 1;
    END WHILE;
ELSEIF @caseBarcode IS NOT NULL THEN # This is "Case" type inventory:
    SET @sql = CONCAT('INSERT INTO ankowhm.inventory_case (ContainerID, Barcode, UserID) VALUES (', QUOTE(inContainer), ', ', QUOTE(inBarcode), ', ', inUserId, ')');
    # IF Quantity > 1, Add values for the other items
    WHILE i < inQuantity DO
        SET @sql = CONCAT(@sql,  ', (', QUOTE(inContainer), ', ', QUOTE(inBarcode), ', ', inUserId, ')');
        SET i = i + 1;
    END WHILE;
END IF;

# Execute the sql if was defined above
IF (@sql IS NOT NULL) THEN
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    SELECT ROW_COUNT() AS InsertedRows, @keycode AS Keycode, inBarcode AS Barcode;
    DEALLOCATE PREPARE stmt;
END IF;

END//
DELIMITER ;
