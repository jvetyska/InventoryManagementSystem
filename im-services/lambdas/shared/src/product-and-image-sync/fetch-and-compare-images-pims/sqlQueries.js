exports.getCurrentImageHashQuery = async (argKeycodes) => {
    return `
        SELECT
            pik.M_KD AS Keycode,
            CONVERT(VARCHAR(256), HASHBYTES('SHA1', CONVERT(VARCHAR(8000), p.IMAGE)), 2)  AS ImageHash
        FROM Kmart_PIM.dbo.ProductImageKeycode pik
        INNER JOIN Kmart_PIM.dbo.ProductImage p ON p.ProductImageId = pik.ProductImageID
        WHERE pik.M_KD IN (${argKeycodes});
    `;
};


exports.getOldImageHashQuery = () => {
    return `
        SELECT pa.Keycode , pa.ImageHash from product_attr pa
        WHERE pa.Keycode IN (?);
    `;
}
