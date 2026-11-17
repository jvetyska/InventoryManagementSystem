CREATE TABLE `inventory_count_schedule` (
  `LocationID` varchar(13) NOT NULL,
  `Hour` int NOT NULL,
  `KeycodeCount` int DEFAULT NULL,
  `HoursToComplete` int DEFAULT NULL,
  PRIMARY KEY (`LocationID`,`Hour`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
