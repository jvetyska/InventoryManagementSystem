DELIMITER //
CREATE DEFINER=`admin`@`%` FUNCTION `calc_mdu`(
    MDUKeycode INT,
    MDUStore INT,
    PDU INT,
    PDUStart DATETIME,
    PDUEnd DATETIME,
    MDUFixture INT
) RETURNS int
    DETERMINISTIC
BEGIN
    DECLARE DEFAULT_MDU INT; # What to Set the MDU if null MDU is recieved
    DECLARE RETURN_MDU INT; # The MDU to RETURN
    SET DEFAULT_MDU = 2; # Default MDU is Set HERE
    
    # Order of precedence:
    # 1. PDU (assuming it's within PDUStart and PDUEnd)
    # 2. MDUKeycode
    # 3. MDUStore
    # 4. Global default MDU
    
    IF (PDU IS NOT NULL AND NOW() >= PDUStart AND NOW() <= PDUEnd) THEN
        SET RETURN_MDU = PDU;
    ELSEIF (MDUKeycode IS NOT NULL) THEN
        SET RETURN_MDU = MDUKeycode;
	ELSEIF (MDUFixture IS NOT NULL) THEN
		SET RETURN_MDU = MDUFixture;
    ELSEIF (MDUStore IS NOT NULL) THEN
        SET RETURN_MDU = MDUStore;
    ELSE
        SET RETURN_MDU = DEFAULT_MDU;
    END IF;

    RETURN RETURN_MDU;
END//
DELIMITER ;
