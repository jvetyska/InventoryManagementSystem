CREATE TABLE `id_generator` (
  `Name` varchar(20) NOT NULL,
  `ID` bigint NOT NULL,
  `Notes` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`Name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
