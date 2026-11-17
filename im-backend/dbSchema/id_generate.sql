DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `id_generate`(
	IN id_name VARCHAR(20), # The name of the row to get/update in the table id_generator
    IN length INTEGER(11), # Total length of the string, number with less digits will have zeroes padded to the left (length includes the prefix)
    IN prefix VARCHAR(20) # Prefix for the string
)
BEGIN

SET @name = id_name;
SET @length = IFNULL(length - IFNULL(LENGTH(prefix), 0), NULL);

IF NOT EXISTS (SELECT ID FROM ankowhm.id_generator WHERE Name = @name) THEN
    INSERT INTO ankowhm.id_generator (Name, ID) VALUES (@name, 0);
END IF;

UPDATE ankowhm.id_generator SET ID = LAST_INSERT_ID(ID + 1) WHERE Name = @name;
SET @length = IFNULL(@length, LENGTH(LAST_INSERT_ID()));
SELECT CONCAT(IFNULL(prefix, ''), LPAD(LAST_INSERT_ID(), @length, '0')) AS ID;

END//
DELIMITER ;
