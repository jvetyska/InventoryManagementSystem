CREATE TABLE `device_printer_type` (
  `Name` varchar(50) NOT NULL,
  `Type` enum('Zebra','DYMO') DEFAULT NULL,
  `Model` varchar(50) DEFAULT NULL,
  `DPI` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`Name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
