CREATE TABLE `product_code` (
  `ProductCode` int NOT NULL,
  `Description` varchar(50) NOT NULL,
  `Priority` enum('1','2') NOT NULL,
  PRIMARY KEY (`ProductCode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
