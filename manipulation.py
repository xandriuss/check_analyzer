import cv2
import numpy as np

img = cv2.imread("assets/test.png", cv2.IMREAD_COLOR)


#resize
img = cv2.resize(img, (400, 400))
img = cv2.resize(img, (400, 400), fx=2, fy=1)

#crop
height, width = img.shape[0], img.shape[1]
img = img[int(height/3) : , 50: -50]


#rotate
img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)

cv2.imshow("test", img)
cv2.waitKey(0)
cv2.destroyAllWindows()