CREATE TABLE `process_tory_data_step_function` (
  `ExecutionName` varchar(200) NOT NULL,
  `InventoryBotID` int DEFAULT NULL,
  `Status` varchar(100) DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`ExecutionName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
