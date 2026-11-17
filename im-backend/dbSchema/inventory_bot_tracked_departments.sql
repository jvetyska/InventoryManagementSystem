CREATE TABLE `inventory_bot_tracked_departments` (
  `DepartmentName` varchar(45) NOT NULL,
  `LocationID` varchar(13) NOT NULL,
  PRIMARY KEY (`DepartmentName`,`LocationID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
