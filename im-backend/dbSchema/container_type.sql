CREATE TABLE `container_type` (
  `ID` varchar(3) NOT NULL,
  `SubType` varchar(3) DEFAULT NULL,
  `Description` varchar(45) DEFAULT NULL,
  `isFoH` tinyint DEFAULT NULL,
  `isBoH` tinyint DEFAULT NULL,
  `isWRH` tinyint DEFAULT NULL,
  `isOffsite` tinyint DEFAULT NULL,
  `isSystemInv` tinyint DEFAULT NULL,
  `BackfillEnabled` tinyint DEFAULT NULL,
  `Priority` int DEFAULT '1',
  `DisplayOrder` int NOT NULL DEFAULT '1',
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
