#NEVEIKIA

#NEVEIKIA

#NEVEIKIA

#NEVEIKIA

#NEVEIKIA

#NEVEIKIA

#NEVEIKIA

#NEVEIKIA

#NEVEIKIA

#NEVEIKIA








import cv2
import numpy as np

img = cv2.imread("assets/image.png")
gray_img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
if img is None:
    print("Image not found or path is wrong")
    exit()

# Shi-Tomasi corner detection
corners = cv2.goodFeaturesToTrack(gray_img, maxCorners=500, qualityLevel=0.01, minDistance=10)
corners = np.int8(corners)
for c in corners:
    x, y = c.ravel()
    cv2.circle(img, center=(x, y), radius=5, color=(0, 0, 255), thickness=-1)


# Harris corner detection

corners = cv2.goodFeaturesToTrack(gray_img, maxCorners=10, qualityLevel=0.2, minDistance=10, useHarrisDetector=True, k=0.01)
corners = np.int8(corners)
for c in corners:
    x, y = c.ravel()
    cv2.circle(img, center=(x, y), radius=10, color=(0, 255, 0), thickness=-1)

cv2.imshow("tests", img)
cv2.waitKey(0)
cv2.destroyAllWindows()