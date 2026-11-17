DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `container_id_generate`(
	IN inLocationID VARCHAR(13), # LocationID for which you want to create container
    IN inType VARCHAR(3), # container type
    IN inSubType VARCHAR(3), # container subType
    IN inContainerQty INTEGER(3) # amount of container user wants to create
)
BEGIN

DECLARE ContainersToCreate INT; # How many container we can create
DECLARE FinalResultString VARCHAR(500); # final container codes
DECLARE currentContainerCount INT; # Current count of the container for given location, type and subtype
DECLARE LastContainerID INT;
DECLARE containerID VARCHAR(20);
DECLARE whileLoopCount INT DEFAULT 0; # While loop interations count
DECLARE MaxWhileLoopIterations INT; # Max interations while loop can make

# first get current container count, so we know how many new containers we can create
SELECT count(*) INTO currentContainerCount
FROM ankowhm.container WHERE LocationID = inLocationID AND Type = inType AND SubType = inSubType;

# SELECT the Last Inserted ID, so we can create new container from that id
SELECT ID INTO LastContainerID
	FROM ankowhm.container_id_generator WHERE LocationID = inLocationID AND Type = inType AND SubType = inSubType;

# case when we are creating container for the first time.
IF LastContainerID IS NULL THEN
	INSERT INTO ankowhm.container_id_generator (LocationID, Type, SubType) VALUES (inLocationID, inType, inSubType);
    SET LastContainerID = 1;
END IF;

# decide how many container we can create for user
# 99 - currentContainerCount should also be the max number of ContainersToCreate.
IF (inContainerQty < (99 - currentContainerCount)) THEN
  SET ContainersToCreate = inContainerQty;
ELSE
    SET ContainersToCreate = (99 - currentContainerCount);
END IF;

# setting the max while loop iterations variable
SET MaxWhileLoopIterations = ContainersToCreate + 10;

Generator: WHILE ContainersToCreate > 0 DO
# construct the containerID, and check that container already exits or not.
SET containerID = CONCAT((SUBSTRING_INDEX(inLocationID, '-', 1)), '-', inType, '-', (LPAD(LastContainerID, 4, inSubType)));
IF NOT EXISTS (SELECT ID FROM ankowhm.container WHERE ID = containerID) THEN
    SET FinalResultString = CONCAT_WS(',',FinalResultString, LPAD(LastContainerID, 4, inSubType));
    SET ContainersToCreate = ContainersToCreate - 1;
END IF;

SET LastContainerID = LastContainerID + 1;
# Also, we can only support max 99 value, so if the ID reaches 99, instead of incrementing, set it back to 0.
IF LastContainerID > 99 THEN
	SET LastContainerID = 0;
END IF;

SET whileLoopCount = whileLoopCount + 1;
# We don't want while loop to run forever, it shouldn’t do more than ContainersToCreate + 10 iterations.
IF  whileLoopCount > MaxWhileLoopIterations THEN
	LEAVE Generator; 
END IF;

END WHILE;

UPDATE ankowhm.container_id_generator 
SET ID = LastContainerID
WHERE LocationID = inLocationID AND Type = inType AND SubType = inSubType;
  
SELECT FinalResultString;

END//
DELIMITER ;
