DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `move_inventory`(
	IN inBarcode CHAR(13),			# This will be a Keycode for a "product" type, or a Barcode for a "case" type
    IN inKeycode INT(8),			# Keycode, when provided, not need to lookup Barcode.
	IN inSourceContainer CHAR(13), 	# The ID of the source container to move inventory out of
    IN inTargetContainer CHAR(13), 	# The ID of the destination
    IN inTaskID BIGINT, 			# TaskID for which we move inventory
	IN inUserId INT,         		# The ID of the user that's executing this
    IN inQuantity INT,				# Quantity, by default 1.
    IN inQuantityMin INT,			# Min Quantity, by default equals to inQuantity. If set to 1, we can move partial items, such as 2 out of 10.
    IN inOnlyAvailableQty TINYINT  	# If 1 then only pick Available Quantity, Else pick all.
)
BEGIN
# MOVE_INVENTORY
# Validate input and move inventory or inventory_case
# Move all Quantity or none.
# Return all details about containers and inventory types.
SET @quantity = IFNULL(inQuantity, 1);
SET @quantityMin = IFNULL(inQuantityMin, @quantity); # quantityMin has to be between 1 and quantity. Set to quantity in any other case to avoid unwanted partial move.
IF (@quantityMin < 1 OR @quantityMin > @quantity) THEN SET @quantityMin = @quantity; END IF;
SET @stmt = NULL;
SET @keycode = inKeycode;
SET @caseBarcode = NULL;
SET @srcContainer = NULL;
SET @srcType = NULL;
SET @srcQty = NULL;
SET @srcAvailQty = NULL;
SET @tgtContainer = NULL;
SET @tgtType = NULL;
SET @qtyMoved = 0;
SET @validationPassed = true;
IF (IFNULL(inOnlyAvailableQty, 0) = 1) THEN SET @onlyAvailable = true; ELSE SET @onlyAvailable = false; END IF;
# Task ID and only available are multually exclusive
IF (inTaskID IS NOT NULL) THEN SET @onlyAvailable = false; END IF;

# FIRST - determine whether we are dealing with inventory (by @keycode) or inventory_case (by @caseBarcode)
IF (inKeycode IS NULL) THEN # When inBarcode is provided, see if it is sku or CaseBarcode first:
	SELECT Keycode INTO @keycode FROM ankowhm.product_barcode WHERE Barcode = inBarcode;
    IF (@keycode IS NULL) THEN
		SET @caseBarcode = inBarcode;
    END IF;
END IF;

# SELECT DETAILS
# At this point @keycode or @caseBarcode is set.
IF (@keycode IS NOT NULL) THEN  # When keycode is provided, lookup inventory by Keycode.
	SELECT src.ID AS srcContainer, src.Type, i.srcQty, i.srcAvailQty, tgt.ID AS tgtContainer, tgt.Type
	INTO @srcContainer, @srcType, @srcQty, @srcAvailQty, @tgtContainer, @tgtType
	FROM (
		SELECT Keycode, COUNT(*) AS srcQty, COUNT(IF(TaskID IS NULL,1,NULL)) AS srcAvailQty
		FROM ankowhm.inventory WHERE ContainerID = inSourceContainer AND Keycode = @keycode
	) AS i
	LEFT JOIN ankowhm.container src ON src.ID = inSourceContainer
	LEFT JOIN ankowhm.container tgt ON tgt.ID = inTargetContainer;
ELSE # Barcode is provided - get either Keycode or caseBarcode.
	SELECT src.ID AS srcContainer, src.Type, i.srcQty, i.srcAvailQty, tgt.ID AS tgtContainer, tgt.Type
	INTO @srcContainer, @srcType, @srcQty, @srcAvailQty, @tgtContainer, @tgtType
	FROM (
		SELECT Barcode, COUNT(*) AS srcQty, COUNT(IF(TaskID IS NULL,1,NULL)) AS srcAvailQty
		FROM ankowhm.inventory_case WHERE ContainerID = inSourceContainer AND Barcode = @caseBarcode
	) AS i
	LEFT JOIN ankowhm.container src ON src.ID = inSourceContainer
	LEFT JOIN ankowhm.container tgt ON tgt.ID = inTargetContainer;
END IF;

# Task ID and only available are multually exclusive
IF (inTaskID IS NOT NULL) THEN SET @onlyAvailable = false; END IF;

# VALIDATION
IF (@srcType IS NULL OR @tgtType IS NULL) THEN SET @validationPassed = false; # Containers must be valid.
ELSEIF (@srcQty IS NULL OR @srcQty < @quantityMin) THEN SET @validationPassed = false; # No or not enough inventory to move.
ELSEIF ((@srcAvailQty IS NULL OR @srcAvailQty < @quantityMin) AND @onlyAvailable = true) THEN SET @validationPassed = false; # if available quantity is less than needed
ELSEIF (((@tgtType = 'STR' AND @srcType != 'STR') OR @tgtType = 'WRH') AND !(@srcType = 'TOT' AND @tgtType = 'STR')) THEN SET @validationPassed = false; # Cannot move inventory to STR or WRH.
ELSE SET @validationPassed = true;
END IF;

# MOVE INVENTORY
IF (@validationPassed = true) THEN
	IF (@keycode IS NOT NULL) THEN SET @stmt = 'UPDATE ankowhm.inventory';
	ELSE SET @stmt = 'UPDATE ankowhm.inventory_case';
	END IF;
    SET @stmt = CONCAT(@stmt, ' SET ContainerID = ', QUOTE(@tgtContainer), ', UserID = ', inUserID);

    # Check for taskID conditions:
    IF ((@srcType = 'CRT' AND @tgtType = 'CRT') OR (@srcType = 'TOT' AND @tgtType = 'TOT')) THEN # if CRT -> CRT, keep the same taskID for inventory.
		SET @placeholder1 = true; # No taskID needs to be passed, keep existing value.
	ELSEIF (@tgtType = 'CRT' OR @tgtType = 'TOT' OR (@srcType = 'TOT' AND @tgtType = 'STR')) THEN # if <any> -> CRT, Use the provided inTaskID value.
		SET @stmt = CONCAT(@stmt, ', TaskID = ', IFNULL(inTaskID, 'null'));
	ELSE # For any -> any, Always set to NULL
		SET @stmt = CONCAT(@stmt, ', TaskID = null');
	END IF;

	SET @stmt = CONCAT(@stmt, ' WHERE ContainerID = ', QUOTE(@srcContainer));

    IF (@keycode IS NOT NULL) THEN
		SET @stmt = CONCAT(@stmt, ' AND  Keycode = ', @keycode);
	ELSE
		SET @stmt = CONCAT(@stmt, ' AND Barcode = ', QUOTE(@caseBarcode));
	END IF;

	# order by based on TaskID
    IF (inTaskID IS NULL) THEN
		SET @stmt = CONCAT(@stmt, ' ORDER BY TaskID LIMIT ?');
	ELSE
		SET @stmt = CONCAT(@stmt, ' ORDER BY CASE WHEN TaskID = ', IFNULL(inTaskID, 'null'), ' THEN 1 WHEN TaskID is null THEN 2 ELSE 3 END LIMIT ?');
	END IF;
    
    IF (@onlyAvailable = true AND @srcAvailQty < @quantity) THEN SET @quantity = @srcAvailQty; END IF; # Only pick available Quantity if minQty is less than requested quantity

	#select @stmt as sql_to_execute;
	#Execute the sql if was defined above
	PREPARE stmt FROM @stmt;
	EXECUTE stmt USING @quantity;
    SELECT ROW_COUNT() INTO @qtyMoved;
	DEALLOCATE PREPARE stmt;
    # Decrease @srcQty by the @qtyMoved.
    IF (@qtyMoved > 0) THEN
		SET @srcQty = @srcQty - @qtyMoved; # Beware - on error, qtyMoved will be -1
    END IF;
END IF;

# RETURN DATA
SELECT @validationPassed AS validationPassed, @qtyMoved AS quantityMoved, @keycode AS keycode, @caseBarcode AS barcode,
	@srcContainer AS srcContainer, @srcType AS srcType, @srcQty AS srcQuantity, @srcAvailQty AS srcAvailQty,
	@tgtContainer AS tgtContainer, @tgtType AS tgtType;

END//
DELIMITER ;
