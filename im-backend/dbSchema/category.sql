CREATE TABLE `category` (
  `DepartmentName` varchar(45) NOT NULL,
  `ParentCategory` varchar(45) NOT NULL,
  `CategoryName` varchar(45) NOT NULL,
  `CategoryID` int NOT NULL,
  PRIMARY KEY (`DepartmentName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
