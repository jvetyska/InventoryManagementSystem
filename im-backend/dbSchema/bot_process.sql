CREATE TABLE `bot_process` (
  `InventoryBotID` int NOT NULL,
  `TaskConfig` varchar(45) NOT NULL,
  `Status` varchar(45) DEFAULT 'HasNotRun',
  `RunName` varchar(45) DEFAULT NULL,
  `Map` varchar(45) DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`InventoryBotID`,`TaskConfig`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
