DELIMITER //
CREATE DEFINER=`admin`@`%` FUNCTION `calculate_need`(WRH_DOC INT, STR_DOC INT, AWS FLOAT, MDU INT, inventory INT) RETURNS float
    DETERMINISTIC
BEGIN
	DECLARE sales FLOAT;
    DECLARE calc FLOAT;
    DECLARE need FLOAT;
    
    SET sales = AWS/7 * WRH_DOC; # the average daily sales times the days of coverage for the warehouse
    SET calc = IF(MDU = 0 AND AWS = 0, 2 * STR_DOC, MDU - inventory); # if the MDU and AWS is 0 then order 2 * the doc otherwise mdu minus the inventory
    SET calc = IF(calc < 0, 0, calc); # if the calculated need is less than zero set to zero
    SET need = sales + calc; # add calculated need plus sales need
    
RETURN need;
END//
DELIMITER ;
