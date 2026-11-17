CREATE TABLE `task_management_system` (
  `Name` varchar(100) NOT NULL,
  `BackfillScheduleID` bigint DEFAULT NULL,
  `Status` varchar(45) DEFAULT NULL,
  `TaskToken` varchar(1000) DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`Name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
