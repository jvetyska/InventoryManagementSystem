CREATE TABLE `container_id_generator` (
  `LocationID` varchar(13) NOT NULL,
  `Type` varchar(3) NOT NULL,
  `SubType` varchar(3) DEFAULT NULL,
  `ID` int NOT NULL DEFAULT '1',
  UNIQUE KEY `ID_UNIQUE` (`LocationID`,`Type`,`SubType`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
