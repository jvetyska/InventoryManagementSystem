exports.getImagesForAllKeycodes = async (argKeycodes) => {
return `
        SELECT
            pik.M_KD AS Keycode,
            p.IMAGE
        FROM Kmart_PIM.dbo.ProductImageKeycode pik
        INNER JOIN Kmart_PIM.dbo.ProductImage p ON p.ProductImageId = pik.ProductImageID
        WHERE pik.M_KD IN (${argKeycodes});
    `;
};

exports.getUpdateAllImageHashQuery = () => {
    return `
    INSERT IGNORE INTO product_attr (keycode, ImageHash)
    VALUES ?
    ON DUPLICATE KEY UPDATE
    ImageHash=VALUES(ImageHash);
    `;
}
