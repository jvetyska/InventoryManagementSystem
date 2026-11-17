CREATE TABLE `container` (
  `ID` varchar(13) NOT NULL,
  `Type` varchar(13) DEFAULT NULL,
  `SubType` varchar(3) DEFAULT NULL,
  `Priority` int DEFAULT NULL,
  `ParentID` varchar(13) DEFAULT NULL,
  `LocationID` varchar(13) DEFAULT NULL,
  `isApparel` enum('Standard','Apparel') NOT NULL DEFAULT 'Standard',
  PRIMARY KEY (`ID`),
  KEY `fk_container_container_idx` (`LocationID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
